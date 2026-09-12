import type { ServerNotification } from "../../../../app-server/connection/rpc-messages";
import { threadFromAppServerRecord } from "../../../../app-server/services/threads";
import type { ThreadTokenUsage, TokenUsageBreakdown } from "../../../../domain/runtime/metrics";
import type { ThreadTokenUsage as AppServerThreadTokenUsage } from "../../../../generated/app-server/v2/ThreadTokenUsage";
import { activeThreadId, activeThreadState, type ChatState } from "../../application/state/model";
import type { ChatAction } from "../../application/state/reducer";
import type { SubagentActivityAction } from "../../application/state/subagent-activity";
import { activeThreadSettingsAppliedAction } from "../../application/state/transition-actions";
import { projectTurnRuntimeFact, type TurnRuntimeProjectionOutcome } from "../../application/turns/runtime-fact-projection";
import type { TurnRuntimeFact } from "../../application/turns/runtime-facts";
import {
  type DiagnosticStatusNotification,
  isStreamOrTurnLifecycleNotification,
  routeServerNotification,
  type ThreadLifecycleNotification,
} from "./notification-routing";
import { type RuntimeFactSource, turnRuntimeFactFromNotification } from "./runtime-fact-adapter";

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
  const fact = turnRuntimeFactFromNotification(notification, localItemId);
  if (!fact) return EMPTY_PLAN;
  const projection = projectTurnRuntimeFact(state, fact);
  return {
    actions: [...projection.actions, ...subagentTrackingActionsFromParentFact(state, fact)],
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
  if (!isStreamOrTurnLifecycleNotification(notification)) return EMPTY_PLAN;
  const fact = turnRuntimeFactFromNotification(notification, localItemId);
  return fact ? { actions: [{ type: "subagent-activity/runtime-fact", threadId, fact }], effects: [] } : EMPTY_PLAN;
}

function subagentTrackingActionsFromParentFact(state: ChatState, fact: TurnRuntimeFact): SubagentActivityAction[] {
  const parentTurnId = activeTurnIdForState(state);
  if (!parentTurnId) return [];
  if (
    fact.type !== "itemStarted" &&
    fact.type !== "itemContentUpdated" &&
    fact.type !== "taskProgressUpdated" &&
    fact.type !== "itemCompleted"
  )
    return [];
  if (fact.item.kind !== "agent" || fact.item.turnId !== parentTurnId) return [];
  const item = fact.item;
  if (item.coordinationUpdate === "snapshot") {
    const threadIds = new Set([...item.targets.map((target) => target.threadId), ...item.agents.map((agent) => agent.threadId)]);
    return [...threadIds].map((threadId) => ({ type: "subagent-activity/tracked", threadId, parentTurnId }));
  }
  const coordinationUpdate = item.coordinationUpdate;
  return item.targets.map((target) => ({
    type: "subagent-activity/coordination-observed",
    threadId: target.threadId,
    parentTurnId,
    agentLabel: target.label ?? null,
    coordinationUpdate,
  }));
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
