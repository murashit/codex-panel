import type { ServerNotification } from "../../../../app-server/connection/rpc-messages";
import { threadFromAppServerRecord } from "../../../../app-server/services/threads";
import { threadTokenUsageFromRuntimeUsage } from "../../../../domain/runtime/metrics";
import { normalizeExplicitThreadName } from "../../../../domain/threads/model";
import type { ThreadFact } from "../../../threads/workflows/thread-facts";
import type { AppServerResourceFact } from "../../application/connection/server-metadata-effects";
import { activeThreadSettingsAppliedAction } from "../../application/state/actions";
import { activeThreadId, activeThreadState, type ChatAction, type ChatState } from "../../application/state/root-reducer";
import type { SubagentActivityAction } from "../../application/state/subagent-activity";
import { projectTurnRuntimeFacts, type TurnRuntimeProjectionOutcome } from "../../application/turns/runtime-fact-projection";
import type { TurnRuntimeFact } from "../../application/turns/runtime-facts";
import { goalChangeItem } from "../../domain/thread-stream/factories/goal-items";
import { type DiagnosticStatusNotification, routeServerNotification, type ThreadLifecycleNotification } from "./notification-routing";
import { turnRuntimeFactsFromNotification } from "./runtime-fact-adapter";

export type ChatInboundEffect =
  | {
      type: "maybe-name-thread";
      threadId: string;
      turnId: string;
      completedTurnTranscriptSummary: TurnCompletionTranscriptSummary;
    }
  | { type: "refresh-server-diagnostics" }
  | { type: "handle-app-server-resource-fact"; fact: AppServerResourceFact }
  | { type: "apply-thread-fact"; fact: ThreadFact };

type TurnCompletionTranscriptSummary = TurnRuntimeProjectionOutcome["completedTurnTranscriptSummary"];

export interface ChatInboundPlan {
  actions: readonly ChatAction[];
  effects: readonly ChatInboundEffect[];
}

export type LocalItemIdProvider = (prefix: string) => string;

const EMPTY_PLAN: ChatInboundPlan = { actions: [], effects: [] };

export function planChatInboundNotification(
  state: ChatState,
  notification: ServerNotification,
  localItemId: LocalItemIdProvider,
): ChatInboundPlan {
  const route = routeServerNotification(notification, {
    activeThreadId: activeThreadId(state),
    activeTurnId: activeTurnIdForState(state),
  });
  switch (route.kind) {
    case "inactive":
      return planTrackedSubagentNotification(state, route.scope.threadId, route.notification, localItemId);
    case "ignored":
    case "unhandled":
      return EMPTY_PLAN;
    case "streamUpdate":
    case "turnLifecycle":
    case "requestResolved":
    case "userVisibleNotice":
      return planTurnRuntimeNotification(state, route.notification, localItemId);
    case "threadLifecycle":
      return planThreadLifecycle(state, route.notification, localItemId);
    case "diagnosticStatus":
      return planDiagnosticStatus(route.notification);
  }
}

function planTurnRuntimeNotification(
  state: ChatState,
  notification: Parameters<typeof turnRuntimeFactsFromNotification>[0],
  localItemId: LocalItemIdProvider,
): ChatInboundPlan {
  const facts = turnRuntimeFactsFromNotification(notification, localItemId);
  const projection = projectTurnRuntimeFacts(state, facts);
  return {
    actions: [...projection.actions, ...subagentTrackingActionsFromParentFacts(state, facts)],
    effects: projection.outcomes.flatMap((outcome) => chatInboundEffectsFromTurnProjectionOutcome(state, outcome)),
  };
}

function planTrackedSubagentNotification(
  state: ChatState,
  threadId: string | null,
  notification: ServerNotification,
  localItemId: LocalItemIdProvider,
): ChatInboundPlan {
  if (!threadId || !state.activeTurn.subagents.byThreadId.has(threadId)) return EMPTY_PLAN;
  const facts = subagentRuntimeFacts(notification, localItemId);
  if (!facts) return EMPTY_PLAN;
  const actions = facts.flatMap((fact) => subagentActivityActionsFromRuntimeFact(threadId, notification.method, fact));
  return actions.length > 0 ? { actions, effects: [] } : EMPTY_PLAN;
}

function subagentRuntimeFacts(notification: ServerNotification, localItemId: LocalItemIdProvider): readonly TurnRuntimeFact[] | null {
  switch (notification.method) {
    case "item/agentMessage/delta":
    case "item/plan/delta":
    case "turn/plan/updated":
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/textDelta":
    case "item/reasoning/summaryPartAdded":
    case "item/started":
    case "item/completed":
    case "item/commandExecution/outputDelta":
    case "item/fileChange/patchUpdated":
    case "turn/diff/updated":
    case "hook/started":
    case "hook/completed":
    case "item/mcpToolCall/progress":
    case "item/autoApprovalReview/started":
    case "item/autoApprovalReview/completed":
    case "guardianWarning":
    case "turn/started":
    case "turn/completed":
      return turnRuntimeFactsFromNotification(notification, localItemId);
    default:
      return null;
  }
}

function subagentActivityActionsFromRuntimeFact(
  threadId: string,
  notificationMethod: ServerNotification["method"],
  fact: TurnRuntimeFact,
): SubagentActivityAction[] {
  switch (fact.type) {
    case "turnStarted":
      return [{ type: "subagent-activity/turn-started", threadId, childTurnId: fact.turnId }];
    case "turnCompleted":
      return [
        {
          type: "subagent-activity/turn-completed",
          threadId,
          childTurnId: fact.turnId,
          items: fact.completedItems,
          outcome: subagentTurnOutcome(fact.status),
        },
      ];
    case "itemUpserted":
      return [
        {
          type: "subagent-activity/item-observed",
          threadId,
          item: fact.item,
          advance: notificationMethod === "item/started" || notificationMethod === "turn/plan/updated",
        },
      ];
    case "userMessageObserved":
      return [];
    case "itemCompleted":
      return [{ type: "subagent-activity/item-observed", threadId, item: fact.item, advance: false }];
    case "assistantDelta":
      return [
        {
          type: "subagent-activity/assistant-delta-appended",
          threadId,
          childTurnId: fact.turnId,
          itemId: fact.itemId,
          delta: fact.delta,
        },
      ];
    case "planDelta":
      return [
        {
          type: "subagent-activity/plan-delta-appended",
          threadId,
          childTurnId: fact.turnId,
          itemId: fact.itemId,
          delta: fact.delta,
        },
      ];
    case "textDelta":
      if (notificationMethod === "item/reasoning/textDelta") return [];
      return [
        {
          type: "subagent-activity/text-delta-appended",
          threadId,
          childTurnId: fact.turnId,
          itemId: fact.itemId,
          label: fact.label,
          delta: fact.delta,
          kind: fact.kind,
        },
      ];
    case "toolOutputDelta":
      return [
        {
          type: "subagent-activity/tool-output-appended",
          threadId,
          childTurnId: fact.turnId,
          itemId: fact.itemId,
          delta: fact.delta,
          fallbackLabel: fact.fallbackLabel,
        },
      ];
    case "hookRunObserved":
      return fact.turnId
        ? [{ type: "subagent-activity/item-observed", threadId, item: { ...fact.item, turnId: fact.turnId }, advance: true }]
        : [];
    case "autoReviewUpdated":
    case "reviewWarning":
      return [{ type: "subagent-activity/item-observed", threadId, item: fact.item, advance: true }];
    case "itemOutputDelta":
    case "turnDiffUpdated":
    case "requestResolved":
    case "systemNotice":
      return [];
  }
}

function subagentTurnOutcome(status: string): "completed" | "failed" | null {
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  return null;
}

function subagentTrackingActionsFromParentFacts(state: ChatState, facts: readonly TurnRuntimeFact[]): SubagentActivityAction[] {
  const parentTurnId = activeTurnIdForState(state);
  if (!parentTurnId) return [];
  const actions: SubagentActivityAction[] = [];
  const trackedThreadIds = new Set<string>();
  for (const fact of facts) {
    if (fact.type !== "itemUpserted" && fact.type !== "itemCompleted") continue;
    if (fact.item.kind !== "agent" || fact.item.turnId !== parentTurnId) continue;
    if (fact.item.coordinationUpdate === "snapshot") {
      for (const target of fact.item.targets) trackedThreadIds.add(target.threadId);
      for (const agent of fact.item.agents) trackedThreadIds.add(agent.threadId);
      continue;
    }
    for (const target of fact.item.targets) {
      actions.push({
        type: "subagent-activity/coordination-observed",
        threadId: target.threadId,
        parentTurnId,
        agentLabel: target.label ?? null,
        coordinationUpdate: fact.item.coordinationUpdate,
      });
    }
  }
  return [...[...trackedThreadIds].map((threadId) => ({ type: "subagent-activity/tracked" as const, threadId, parentTurnId })), ...actions];
}

function chatInboundEffectsFromTurnProjectionOutcome(
  state: ChatState,
  outcome: TurnRuntimeProjectionOutcome,
): readonly ChatInboundEffect[] {
  if (activeThreadState(state)?.lifetime?.kind === "ephemeral") return [];
  return [
    {
      type: "maybe-name-thread",
      threadId: outcome.threadId,
      turnId: outcome.turnId,
      completedTurnTranscriptSummary: outcome.completedTurnTranscriptSummary,
    },
  ];
}

function planDiagnosticStatus(notification: DiagnosticStatusNotification): ChatInboundPlan {
  switch (notification.method) {
    case "thread/tokenUsage/updated":
      return actionPlan({
        type: "active-thread/token-usage-set",
        tokenUsage: threadTokenUsageFromRuntimeUsage(notification.params.tokenUsage),
      });
    case "account/rateLimits/updated":
      return effectPlan({
        type: "handle-app-server-resource-fact",
        fact: { type: "rate-limits-updated" },
      });
    case "skills/changed":
      return effectPlan({ type: "handle-app-server-resource-fact", fact: { type: "skills-changed" } });
    case "app/list/updated":
      return effectPlan({ type: "refresh-server-diagnostics" });
    case "mcpServer/oauthLogin/completed":
      return effectPlan({ type: "refresh-server-diagnostics" });
    case "mcpServer/startupStatus/updated":
      return effectPlan({
        type: "handle-app-server-resource-fact",
        fact: {
          type: "mcp-startup-status-updated",
          name: notification.params.name,
          status: notification.params.status,
          message: notification.params.error,
        },
      });
  }
}

function planThreadLifecycle(
  state: ChatState,
  notification: ThreadLifecycleNotification,
  localItemId: LocalItemIdProvider,
): ChatInboundPlan {
  switch (notification.method) {
    case "thread/started":
      return threadStartedPlan(state, notification);
    case "thread/archived":
      return effectPlan({
        type: "apply-thread-fact",
        fact: { type: "thread-archived", threadId: notification.params.threadId },
      });
    case "thread/deleted":
      return effectPlan({
        type: "apply-thread-fact",
        fact: { type: "thread-deleted", threadId: notification.params.threadId },
      });
    case "thread/unarchived":
      return effectPlan({
        type: "apply-thread-fact",
        fact: { type: "thread-unarchived", threadId: notification.params.threadId },
      });
    case "thread/name/updated":
      return effectPlan({
        type: "apply-thread-fact",
        fact: {
          type: "thread-renamed",
          threadId: notification.params.threadId,
          name: normalizeExplicitThreadName(notification.params.threadName),
        },
      });
    case "thread/settings/updated":
      if (activeThreadId(state) !== notification.params.threadId) return EMPTY_PLAN;
      return actionPlan(activeThreadSettingsAppliedAction(notification.params.threadSettings));
    case "thread/goal/updated":
      return threadGoalPlan(state, notification.params.threadId, notification.params.goal, localItemId);
    case "thread/goal/cleared":
      return threadGoalPlan(state, notification.params.threadId, null, localItemId);
  }
}

function threadStartedPlan(
  state: ChatState,
  notification: Extract<ThreadLifecycleNotification, { method: "thread/started" }>,
): ChatInboundPlan {
  const thread = threadFromAppServerRecord(notification.params.thread);
  const activeParentTurnId = activeTurnIdForState(state);
  const trackAction: SubagentActivityAction[] =
    thread.provenance.kind === "subagent" && thread.provenance.parentThreadId === activeThreadId(state) && activeParentTurnId
      ? [{ type: "subagent-activity/tracked", threadId: thread.id, parentTurnId: activeParentTurnId }]
      : [];
  return { actions: trackAction, effects: [] };
}

function threadGoalPlan(
  state: ChatState,
  threadId: string,
  goal: Extract<ThreadLifecycleNotification, { method: "thread/goal/updated" }>["params"]["goal"] | null,
  localItemId: LocalItemIdProvider,
): ChatInboundPlan {
  const activeThread = activeThreadState(state);
  if (!activeThread || activeThread.id !== threadId) return EMPTY_PLAN;
  const actions: ChatAction[] = [{ type: "active-thread/goal-set", goal }];
  const item = goalChangeItem(localItemId("goal"), activeThread.goal, goal);
  if (item) actions.push({ type: "thread-stream/item-upserted", item });
  return { actions, effects: [] };
}

function activeTurnIdForState(state: ChatState): string | null {
  const lifecycle = state.activeTurn.lifecycle;
  return lifecycle.kind === "running" ? lifecycle.turnId : null;
}

function actionPlan(action: ChatAction): ChatInboundPlan {
  return { actions: [action], effects: [] };
}

function effectPlan(effect: ChatInboundEffect): ChatInboundPlan {
  return { actions: [], effects: [effect] };
}
