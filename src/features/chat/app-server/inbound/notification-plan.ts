import type { ServerNotification } from "../../../../app-server/connection/rpc-messages";
import { threadFromAppServerRecord } from "../../../../app-server/services/threads";
import { threadTokenUsageFromRuntimeUsage } from "../../../../domain/runtime/metrics";
import { normalizeExplicitThreadName } from "../../../../domain/threads/model";
import type { ThreadCatalogEvent } from "../../../threads/catalog/thread-catalog";
import type { AppServerResourceEvent } from "../../application/connection/server-metadata-actions";
import { activeThreadSettingsAppliedAction } from "../../application/state/actions";
import type { ChatAction, ChatState } from "../../application/state/root-reducer";
import { planTurnRuntimeEvents, type TurnRuntimeOutcome } from "../../application/turns/runtime-event-plan";
import { goalChangeItem } from "../../domain/thread-stream/factories/goal-items";
import { type DiagnosticStatusNotification, routeServerNotification, type ThreadLifecycleNotification } from "./notification-routing";
import { turnRuntimeEventsFromNotification } from "./runtime-events";

export type ChatNotificationEffect =
  | { type: "refresh-threads" }
  | {
      type: "maybe-name-thread";
      threadId: string;
      turnId: string;
      completedTurnTranscriptSummary: TurnRuntimeCompletedTurnTranscriptSummary;
    }
  | { type: "refresh-server-diagnostics"; forceResourceProbes?: boolean }
  | { type: "apply-app-server-resource-event"; event: AppServerResourceEvent }
  | { type: "apply-thread-catalog-event"; event: ThreadCatalogEvent };

type TurnRuntimeCompletedTurnTranscriptSummary = Extract<TurnRuntimeOutcome, { type: "turn-completed" }>["completedTurnTranscriptSummary"];

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
    activeThreadId: state.activeThread.id,
    activeTurnId: activeTurnIdForState(state),
  });
  switch (route.kind) {
    case "inactive":
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
  const plan = planTurnRuntimeEvents(state, turnRuntimeEventsFromNotification(notification, localItemId));
  return {
    actions: plan.actions,
    effects: plan.outcomes.flatMap((outcome) => chatNotificationEffectsFromTurnRuntimeOutcome(state, outcome)),
  };
}

function chatNotificationEffectsFromTurnRuntimeOutcome(state: ChatState, outcome: TurnRuntimeOutcome): readonly ChatNotificationEffect[] {
  if (state.activeThread.lifetime?.kind === "ephemeral") return [];
  switch (outcome.type) {
    case "turn-started":
      return [
        {
          type: "apply-thread-catalog-event",
          event: { type: "thread-touched", threadId: outcome.threadId, recencyAt: outcome.recencyAt },
        },
      ];
    case "turn-completed":
      return [
        {
          type: "maybe-name-thread",
          threadId: outcome.threadId,
          turnId: outcome.turnId,
          completedTurnTranscriptSummary: outcome.completedTurnTranscriptSummary,
        },
        { type: "refresh-threads" },
      ];
  }
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
        event: { type: "rate-limits-updated", preserveExistingOnFailure: true },
      });
    case "skills/changed":
      return effectPlan({ type: "apply-app-server-resource-event", event: { type: "skills-changed", forceReload: true } });
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
      if (state.activeThread.id !== notification.params.threadId) return EMPTY_PLAN;
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
  const effects: ChatNotificationEffect[] =
    notification.params.thread.ephemeral || thread.provenance.kind === "subagent"
      ? []
      : [
          {
            type: "apply-thread-catalog-event",
            event: { type: "thread-started", thread },
          },
        ];
  if (!state.activeThread.id || state.activeThread.id === notification.params.thread.id) {
    return { actions: [{ type: "active-thread/cwd-set", cwd: notification.params.thread.cwd }], effects };
  }
  return { actions: [], effects };
}

function threadGoalPlan(
  state: ChatState,
  threadId: string,
  goal: Extract<ThreadLifecycleNotification, { method: "thread/goal/updated" }>["params"]["goal"] | null,
  localItemId: LocalItemIdProvider,
): ChatNotificationPlan {
  if (state.activeThread.id !== threadId) return EMPTY_PLAN;
  const actions: ChatAction[] = [{ type: "active-thread/goal-set", goal }];
  const item = goalChangeItem(localItemId("goal"), state.activeThread.goal, goal);
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
