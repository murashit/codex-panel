import type { ServerNotification } from "../../../../app-server/connection/rpc-messages";
import { threadFromAppServerRecord } from "../../../../app-server/services/threads";
import type { ThreadTokenUsage, TokenUsageBreakdown } from "../../../../domain/runtime/metrics";
import type { ThreadTokenUsage as AppServerThreadTokenUsage } from "../../../../generated/app-server/v2/ThreadTokenUsage";
import { activeThreadId, activeThreadState, type ChatState } from "../../application/state/model";
import type { ChatAction } from "../../application/state/reducer";
import type { SubagentActivityAction } from "../../application/state/subagent-activity";
import { activeThreadSettingsAppliedAction } from "../../application/state/transition-actions";
import { projectTurnRuntimeFacts, type TurnRuntimeProjectionOutcome } from "../../application/turns/runtime-fact-projection";
import type { TurnRuntimeFact } from "../../application/turns/runtime-facts";
import { type DiagnosticStatusNotification, routeServerNotification, type ThreadLifecycleNotification } from "./notification-routing";
import { type RuntimeFactSource, turnRuntimeFactsFromNotification } from "./runtime-fact-adapter";

export type ChatInboundEffect = {
  type: "maybe-name-thread";
  threadId: string;
  turnId: string;
  completedTurnTranscriptSummary: TurnCompletionTranscriptSummary;
};

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
      return planThreadLifecycle(state, route.notification);
    case "diagnosticStatus":
      return planDiagnosticStatus(route.notification);
  }
}

function planTurnRuntimeNotification(state: ChatState, notification: RuntimeFactSource, localItemId: LocalItemIdProvider): ChatInboundPlan {
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
  const actions = facts.map((fact): SubagentActivityAction => ({ type: "subagent-activity/runtime-fact", threadId, fact }));
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
    case "modelProvider/authRecoveryStarted":
    case "modelProvider/authRecoveryCompleted":
      return turnRuntimeFactsFromNotification(notification, localItemId);
    default:
      return null;
  }
}

function subagentTrackingActionsFromParentFacts(state: ChatState, facts: readonly TurnRuntimeFact[]): SubagentActivityAction[] {
  const parentTurnId = activeTurnIdForState(state);
  if (!parentTurnId) return [];
  const actions: SubagentActivityAction[] = [];
  const trackedThreadIds = new Set<string>();
  for (const fact of facts) {
    if (
      fact.type !== "itemStarted" &&
      fact.type !== "itemContentUpdated" &&
      fact.type !== "taskProgressUpdated" &&
      fact.type !== "itemCompleted"
    )
      continue;
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
    case "app/list/updated":
    case "mcpServer/oauthLogin/completed":
    case "mcpServer/startupStatus/updated":
      return EMPTY_PLAN;
  }
}

function planThreadLifecycle(state: ChatState, notification: ThreadLifecycleNotification): ChatInboundPlan {
  switch (notification.method) {
    case "thread/started":
      return threadStartedPlan(state, notification);
    case "thread/settings/updated":
      if (activeThreadId(state) !== notification.params.threadId) return EMPTY_PLAN;
      return actionPlan(activeThreadSettingsAppliedAction(notification.params.threadSettings));
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

function activeTurnIdForState(state: ChatState): string | null {
  const lifecycle = state.activeTurn.lifecycle;
  return lifecycle.kind === "running" ? lifecycle.turnId : null;
}

function actionPlan(action: ChatAction): ChatInboundPlan {
  return { actions: [action], effects: [] };
}

function threadTokenUsageFromRuntimeUsage(usage: AppServerThreadTokenUsage): ThreadTokenUsage {
  return {
    total: tokenUsageBreakdownFromRuntimeBreakdown(usage.total),
    last: tokenUsageBreakdownFromRuntimeBreakdown(usage.last),
    modelContextWindow: usage.modelContextWindow,
  };
}

function tokenUsageBreakdownFromRuntimeBreakdown(breakdown: AppServerThreadTokenUsage["total"]): TokenUsageBreakdown {
  return {
    totalTokens: breakdown.totalTokens,
    inputTokens: breakdown.inputTokens,
    cachedInputTokens: breakdown.cachedInputTokens,
    outputTokens: breakdown.outputTokens,
    reasoningOutputTokens: breakdown.reasoningOutputTokens,
  };
}
