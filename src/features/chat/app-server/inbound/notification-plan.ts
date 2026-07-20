import type { ServerNotification } from "../../../../app-server/connection/rpc-messages";
import { threadFromAppServerRecord } from "../../../../app-server/services/threads";
import { threadTokenUsageFromRuntimeUsage } from "../../../../domain/runtime/metrics";
import { normalizeExplicitThreadName } from "../../../../domain/threads/model";
import type { ThreadCatalogEvent } from "../../../threads/catalog/thread-catalog";
import type { AppServerResourceEvent } from "../../application/connection/server-metadata-actions";
import { activeThreadSettingsAppliedAction } from "../../application/state/actions";
import { activeThreadId, activeThreadState, type ChatAction, type ChatState } from "../../application/state/root-reducer";
import type { SubagentActivityAction } from "../../application/state/subagent-activity";
import { planTurnRuntimeEvents, type TurnRuntimeOutcome } from "../../application/turns/runtime-event-plan";
import type { TurnRuntimeEvent } from "../../application/turns/runtime-events";
import { goalChangeItem } from "../../domain/thread-stream/factories/goal-items";
import { type DiagnosticStatusNotification, routeServerNotification, type ThreadLifecycleNotification } from "./notification-routing";
import { turnRuntimeEventsFromNotification } from "./runtime-events";

export type ChatNotificationEffect =
  | {
      type: "maybe-name-thread";
      threadId: string;
      turnId: string;
      completedTurnTranscriptSummary: TurnRuntimeCompletedTurnTranscriptSummary;
    }
  | { type: "refresh-server-diagnostics"; forceResourceProbes?: boolean }
  | { type: "apply-app-server-resource-event"; event: AppServerResourceEvent }
  | { type: "apply-thread-catalog-event"; event: ThreadCatalogEvent };

type TurnRuntimeCompletedTurnTranscriptSummary = TurnRuntimeOutcome["completedTurnTranscriptSummary"];

export interface ChatNotificationPlan {
  actions: readonly ChatAction[];
  effects: readonly ChatNotificationEffect[];
}

export type LocalItemIdProvider = (prefix: string) => string;

const EMPTY_PLAN: ChatNotificationPlan = { actions: [], effects: [] };

export function planChatNotification(
  state: ChatState,
  notification: ServerNotification,
  localItemId: LocalItemIdProvider,
): ChatNotificationPlan {
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
      return runtimeEventsPlan(state, route.notification, localItemId);
    case "threadLifecycle":
      return planThreadLifecycle(state, route.notification, localItemId);
    case "diagnosticStatus":
      return planDiagnosticStatus(route.notification);
  }
}

function runtimeEventsPlan(
  state: ChatState,
  notification: Parameters<typeof turnRuntimeEventsFromNotification>[0],
  localItemId: LocalItemIdProvider,
): ChatNotificationPlan {
  const events = turnRuntimeEventsFromNotification(notification, localItemId);
  const plan = planTurnRuntimeEvents(state, events);
  return {
    actions: [
      ...plan.actions,
      ...subagentTrackingActionsFromParentEvents(state, events),
      ...subagentTrackingActionsFromActivityItem(state, notification),
    ],
    effects: plan.outcomes.flatMap((outcome) => chatNotificationEffectsFromTurnRuntimeOutcome(state, outcome)),
  };
}

function subagentTrackingActionsFromActivityItem(
  state: ChatState,
  notification: Parameters<typeof turnRuntimeEventsFromNotification>[0],
): SubagentActivityAction[] {
  if (notification.method !== "item/started" && notification.method !== "item/completed") return [];
  const item = notification.params.item;
  if (item.type !== "subAgentActivity") return [];
  const parentTurnId = activeTurnIdForState(state);
  if (!parentTurnId || notification.params.turnId !== parentTurnId) return [];
  const tracked: SubagentActivityAction = {
    type: "subagent-activity/tracked",
    threadId: item.agentThreadId,
    parentTurnId,
  };
  return item.kind === "interrupted"
    ? [tracked, { type: "subagent-activity/execution-state-changed", threadId: item.agentThreadId, executionState: "failed" }]
    : [tracked];
}

function planTrackedSubagentNotification(
  state: ChatState,
  threadId: string | null,
  notification: ServerNotification,
  localItemId: LocalItemIdProvider,
): ChatNotificationPlan {
  if (!threadId || !state.subagentActivity.byThreadId.has(threadId)) return EMPTY_PLAN;
  const events = subagentRuntimeEvents(notification, localItemId);
  if (!events) return EMPTY_PLAN;
  const actions = events.flatMap((event) => subagentActivityActionsFromRuntimeEvent(threadId, notification.method, event));
  return actions.length > 0 ? { actions, effects: [] } : EMPTY_PLAN;
}

function subagentRuntimeEvents(notification: ServerNotification, localItemId: LocalItemIdProvider): readonly TurnRuntimeEvent[] | null {
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
      return turnRuntimeEventsFromNotification(notification, localItemId);
    default:
      return null;
  }
}

function subagentActivityActionsFromRuntimeEvent(
  threadId: string,
  notificationMethod: ServerNotification["method"],
  event: TurnRuntimeEvent,
): SubagentActivityAction[] {
  switch (event.type) {
    case "turnStarted":
      return [{ type: "subagent-activity/turn-started", threadId, childTurnId: event.turnId }];
    case "turnCompleted":
      return [
        {
          type: "subagent-activity/turn-completed",
          threadId,
          childTurnId: event.turnId,
          items: event.completedItems,
          executionState: event.status === "completed" ? "completed" : "failed",
        },
      ];
    case "itemUpserted":
      return [
        {
          type: "subagent-activity/item-observed",
          threadId,
          item: event.item,
          advance: notificationMethod === "item/started" || notificationMethod === "turn/plan/updated",
        },
      ];
    case "itemCompleted":
      return [{ type: "subagent-activity/item-observed", threadId, item: event.item, advance: false }];
    case "assistantDelta":
      return [
        {
          type: "subagent-activity/assistant-delta-appended",
          threadId,
          childTurnId: event.turnId,
          itemId: event.itemId,
          delta: event.delta,
        },
      ];
    case "planDelta":
      return [
        {
          type: "subagent-activity/plan-delta-appended",
          threadId,
          childTurnId: event.turnId,
          itemId: event.itemId,
          delta: event.delta,
        },
      ];
    case "textDelta":
      if (notificationMethod === "item/reasoning/textDelta") return [];
      return [
        {
          type: "subagent-activity/text-delta-appended",
          threadId,
          childTurnId: event.turnId,
          itemId: event.itemId,
          label: event.label,
          delta: event.delta,
          kind: event.kind,
        },
      ];
    case "toolOutputDelta":
      return [
        {
          type: "subagent-activity/tool-output-appended",
          threadId,
          childTurnId: event.turnId,
          itemId: event.itemId,
          delta: event.delta,
          fallbackLabel: event.fallbackLabel,
        },
      ];
    case "hookRunObserved":
      return event.turnId
        ? [{ type: "subagent-activity/item-observed", threadId, item: { ...event.item, turnId: event.turnId }, advance: true }]
        : [];
    case "autoReviewUpdated":
    case "reviewWarning":
      return [{ type: "subagent-activity/item-observed", threadId, item: event.item, advance: true }];
    case "itemOutputDelta":
    case "turnDiffUpdated":
    case "requestResolved":
    case "systemNotice":
      return [];
  }
}

function subagentTrackingActionsFromParentEvents(state: ChatState, events: readonly TurnRuntimeEvent[]): SubagentActivityAction[] {
  const parentTurnId = activeTurnIdForState(state);
  if (!parentTurnId) return [];
  const threadIds = new Set<string>();
  for (const event of events) {
    if (event.type !== "itemUpserted" && event.type !== "itemCompleted") continue;
    if (event.item.kind !== "agent" || event.item.turnId !== parentTurnId) continue;
    for (const threadId of event.item.receiverThreadIds) threadIds.add(threadId);
    for (const agent of event.item.agents) threadIds.add(agent.threadId);
  }
  return [...threadIds].map((threadId) => ({ type: "subagent-activity/tracked", threadId, parentTurnId }));
}

function chatNotificationEffectsFromTurnRuntimeOutcome(state: ChatState, outcome: TurnRuntimeOutcome): readonly ChatNotificationEffect[] {
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

function planDiagnosticStatus(notification: DiagnosticStatusNotification): ChatNotificationPlan {
  switch (notification.method) {
    case "thread/tokenUsage/updated":
      return actionPlan({
        type: "active-thread/token-usage-set",
        tokenUsage: threadTokenUsageFromRuntimeUsage(notification.params.tokenUsage),
      });
    case "account/rateLimits/updated":
      return effectPlan({
        type: "apply-app-server-resource-event",
        event: { type: "rate-limits-updated" },
      });
    case "skills/changed":
      return effectPlan({ type: "apply-app-server-resource-event", event: { type: "skills-changed" } });
    case "app/list/updated":
      return effectPlan({ type: "refresh-server-diagnostics" });
    case "mcpServer/oauthLogin/completed":
      return effectPlan({ type: "refresh-server-diagnostics", forceResourceProbes: true });
    case "mcpServer/startupStatus/updated":
      return effectPlan({
        type: "apply-app-server-resource-event",
        event: {
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
): ChatNotificationPlan {
  switch (notification.method) {
    case "thread/started":
      return threadStartedPlan(state, notification);
    case "thread/archived":
      return effectPlan({ type: "apply-thread-catalog-event", event: { type: "thread-archived", threadId: notification.params.threadId } });
    case "thread/deleted":
      return effectPlan({ type: "apply-thread-catalog-event", event: { type: "thread-deleted", threadId: notification.params.threadId } });
    case "thread/unarchived":
      return effectPlan({
        type: "apply-thread-catalog-event",
        event: { type: "thread-unarchived", threadId: notification.params.threadId },
      });
    case "thread/name/updated":
      return effectPlan({
        type: "apply-thread-catalog-event",
        event: {
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
): ChatNotificationPlan {
  const thread = threadFromAppServerRecord(notification.params.thread);
  const activeParentTurnId = activeTurnIdForState(state);
  const trackAction: SubagentActivityAction[] =
    thread.provenance.kind === "subagent" && thread.provenance.parentThreadId === activeThreadId(state) && activeParentTurnId
      ? [{ type: "subagent-activity/tracked", threadId: thread.id, parentTurnId: activeParentTurnId }]
      : [];
  const effects: ChatNotificationEffect[] =
    notification.params.thread.ephemeral || thread.provenance.kind === "subagent"
      ? []
      : [
          {
            type: "apply-thread-catalog-event",
            event: { type: "thread-upserted", thread },
          },
        ];
  return { actions: trackAction, effects };
}

function threadGoalPlan(
  state: ChatState,
  threadId: string,
  goal: Extract<ThreadLifecycleNotification, { method: "thread/goal/updated" }>["params"]["goal"] | null,
  localItemId: LocalItemIdProvider,
): ChatNotificationPlan {
  const activeThread = activeThreadState(state);
  if (!activeThread || activeThread.id !== threadId) return EMPTY_PLAN;
  const actions: ChatAction[] = [{ type: "active-thread/goal-set", goal }];
  const item = goalChangeItem(localItemId("goal"), activeThread.goal, goal);
  if (item) actions.push({ type: "thread-stream/item-upserted", item });
  return { actions, effects: [] };
}

function activeTurnIdForState(state: ChatState): string | null {
  const lifecycle = state.turn.lifecycle;
  return lifecycle.kind === "running" ? lifecycle.turnId : null;
}

function actionPlan(action: ChatAction): ChatNotificationPlan {
  return { actions: [action], effects: [] };
}

function effectPlan(effect: ChatNotificationEffect): ChatNotificationPlan {
  return { actions: [], effects: [effect] };
}
