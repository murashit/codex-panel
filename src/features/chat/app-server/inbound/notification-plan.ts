import type { ServerNotification } from "../../../../app-server/connection/rpc-messages";
import { threadFromAppServerRecord } from "../../../../app-server/threads";
import { threadTokenUsageFromRuntimeUsage } from "../../../../domain/runtime/metrics";
import { normalizeExplicitThreadName } from "../../../../domain/threads/model";
import type { ThreadConversationSummary } from "../../../../domain/threads/transcript";
import { jsonPreview } from "../../../../shared/text/preview";
import type { ThreadCatalogEvent } from "../../../../workspace/thread-catalog";
import { activeTurnId, pendingTurnStart as pendingTurnStartForState } from "../../application/conversation/turn-state";
import { activeThreadSettingsAppliedAction } from "../../application/state/actions";
import { messageStreamItems } from "../../application/state/message-stream";
import type { ChatAction, ChatState } from "../../application/state/root-reducer";
import { reconcileCompletedTurnItems } from "../../domain/message-stream/completed-turn-reconciliation";
import { goalChangeItem } from "../../domain/message-stream/factories/goal-items";
import {
  STREAMED_COMMAND_RUNNING_TEXT,
  STREAMED_FILE_CHANGE_IN_PROGRESS_TEXT,
  STREAMED_MCP_PROGRESS_LABEL,
} from "../../domain/message-stream/factories/streaming-items";
import { createSystemItem } from "../../domain/message-stream/factories/system-items";
import type { MessageStreamItem, MessageStreamItemKind } from "../../domain/message-stream/items";
import { attachHookRunsToTurn, completeReasoningItems, upsertMessageStreamItemById } from "../../domain/message-stream/updates";
import type { AppServerResourceEvent } from "../actions/metadata";
import {
  type AppServerFileChange,
  normalizeFileChanges,
  streamingFileChangeMessageStreamItem,
} from "../mappers/message-stream/file-changes";
import { hookRunMessageStreamItem } from "../mappers/message-stream/hook-run-items";
import { createAutoReviewResultItem, createReviewResultItem } from "../mappers/message-stream/review-result-items";
import { taskProgressMessageStreamItem } from "../mappers/message-stream/task-progress";
import {
  type AppServerTurnItem,
  completedConversationSummaryFromAppServerTurn,
  messageStreamItemFromTurnItem,
  messageStreamItemsFromTurns,
  shouldSuppressLifecycleItem,
} from "../mappers/message-stream/turn-items";
import {
  type DiagnosticStatusNotification,
  type DiagnosticStatusNotificationMethod,
  routeServerNotification,
  type StreamUpdateNotification,
  type StreamUpdateNotificationMethod,
  type ThreadLifecycleNotification,
  type ThreadLifecycleNotificationMethod,
  type TurnLifecycleNotification,
  type TurnLifecycleNotificationMethod,
  type UserVisibleNoticeNotification,
  type UserVisibleNoticeNotificationMethod,
} from "./notification-routing";

export type ChatNotificationEffect =
  | { type: "refresh-threads" }
  | { type: "refresh-server-diagnostics"; forceResourceProbes?: boolean }
  | { type: "apply-app-server-resource-event"; event: AppServerResourceEvent }
  | { type: "maybe-name-thread"; threadId: string; turnId: string; completedSummary: ThreadConversationSummary | null }
  | { type: "apply-thread-catalog-event"; event: ThreadCatalogEvent };

export interface ChatNotificationPlan {
  actions: readonly ChatAction[];
  effects: readonly ChatNotificationEffect[];
}

export type LocalItemIdProvider = (prefix: string) => string;

const EMPTY_PLAN: ChatNotificationPlan = { actions: [], effects: [] };
const MESSAGE_CONTEXT_COMPACTED = "Context compacted.";

type ServerNotificationPlanner<M extends ServerNotification["method"]> = (
  notification: Extract<ServerNotification, { method: M }>,
) => ChatNotificationPlan;
type ServerNotificationPlannerMap<M extends ServerNotification["method"]> = { [Method in M]: ServerNotificationPlanner<Method> };
type ServerNotificationLocalPlanner<M extends ServerNotification["method"]> = (
  notification: Extract<ServerNotification, { method: M }>,
  localItemId: LocalItemIdProvider,
) => ChatNotificationPlan;
type ServerNotificationLocalPlannerMap<M extends ServerNotification["method"]> = {
  [Method in M]: ServerNotificationLocalPlanner<Method>;
};
type ServerNotificationStatePlanner<M extends ServerNotification["method"]> = (
  state: ChatState,
  notification: Extract<ServerNotification, { method: M }>,
  localItemId: LocalItemIdProvider,
) => ChatNotificationPlan;
type ServerNotificationStatePlannerMap<M extends ServerNotification["method"]> = {
  [Method in M]: ServerNotificationStatePlanner<Method>;
};

const DIAGNOSTIC_STATUS_PLANNERS = {
  "thread/tokenUsage/updated": (notification) =>
    actionPlan({
      type: "active-thread/token-usage-set",
      tokenUsage: threadTokenUsageFromRuntimeUsage(notification.params.tokenUsage),
    }),
  "account/rateLimits/updated": () => ({
    actions: [],
    effects: [{ type: "apply-app-server-resource-event", event: { type: "rate-limits-updated", preserveExistingOnFailure: true } }],
  }),
  "skills/changed": () => ({
    actions: [],
    effects: [{ type: "apply-app-server-resource-event", event: { type: "skills-changed", forceReload: true } }],
  }),
  "app/list/updated": () => ({
    actions: [],
    effects: [{ type: "refresh-server-diagnostics" }],
  }),
  "mcpServer/oauthLogin/completed": () => ({
    actions: [],
    effects: [{ type: "refresh-server-diagnostics", forceResourceProbes: true }],
  }),
  "mcpServer/startupStatus/updated": (notification) => ({
    actions: [],
    effects: [
      {
        type: "apply-app-server-resource-event",
        event: {
          type: "mcp-startup-status-updated",
          name: notification.params.name,
          status: notification.params.status,
          message: notification.params.error,
        },
      },
    ],
  }),
} satisfies ServerNotificationPlannerMap<DiagnosticStatusNotificationMethod>;

const USER_VISIBLE_NOTICE_PLANNERS = {
  "thread/compacted": (_notification, localItemId) => systemMessagePlan({ id: localItemId("system"), text: MESSAGE_CONTEXT_COMPACTED }),
  "model/rerouted": jsonNoticePlan,
  deprecationNotice: jsonNoticePlan,
  error: jsonNoticePlan,
  warning: jsonNoticePlan,
  configWarning: jsonNoticePlan,
  "windows/worldWritableWarning": jsonNoticePlan,
  "windowsSandbox/setupCompleted": (notification, localItemId) =>
    notification.params.success ? EMPTY_PLAN : jsonNoticePlan(notification, localItemId),
} satisfies ServerNotificationLocalPlannerMap<UserVisibleNoticeNotificationMethod>;

const STREAM_UPDATE_PLANNERS = {
  "item/agentMessage/delta": (_state, notification) => {
    const { params } = notification;
    return actionPlan({
      type: "message-stream/assistant-delta-appended",
      itemId: params.itemId,
      turnId: params.turnId,
      delta: params.delta,
      completeReasoning: true,
    });
  },
  "item/plan/delta": (_state, notification) => {
    const { params } = notification;
    return actionPlan({
      type: "message-stream/plan-delta-appended",
      itemId: params.itemId,
      turnId: params.turnId,
      delta: params.delta,
    });
  },
  "turn/plan/updated": (_state, notification) =>
    actionPlan({
      type: "message-stream/item-upserted",
      item: taskProgressMessageStreamItem(notification.params.turnId, notification.params.explanation, notification.params.plan),
    }),
  "item/reasoning/summaryTextDelta": (state, notification) =>
    appendToolTextPlan(state, notification.params.itemId, notification.params.turnId, "reasoning", notification.params.delta, "reasoning"),
  "item/reasoning/textDelta": (state, notification) =>
    appendToolTextPlan(state, notification.params.itemId, notification.params.turnId, "reasoning", notification.params.delta, "reasoning"),
  "item/reasoning/summaryPartAdded": (state, notification) =>
    appendToolTextPlan(state, notification.params.itemId, notification.params.turnId, "reasoning", "", "reasoning"),
  "item/started": (_state, notification) => startedItemPlan(notification.params.item, notification.params.turnId),
  "item/completed": (_state, notification) => completedItemPlan(notification.params.item, notification.params.turnId),
  "item/commandExecution/outputDelta": (_state, notification) =>
    actionPlan({
      type: "message-stream/item-output-appended",
      itemId: notification.params.itemId,
      turnId: notification.params.turnId,
      delta: notification.params.delta,
      kind: "command",
      fallbackText: STREAMED_COMMAND_RUNNING_TEXT,
    }),
  "item/fileChange/patchUpdated": (_state, notification) =>
    fileChangePlan(notification.params.itemId, notification.params.turnId, notification.params.changes, "inProgress"),
  "item/fileChange/outputDelta": (_state, notification) =>
    actionPlan({
      type: "message-stream/item-output-appended",
      itemId: notification.params.itemId,
      turnId: notification.params.turnId,
      delta: notification.params.delta,
      kind: "fileChange",
      fallbackText: STREAMED_FILE_CHANGE_IN_PROGRESS_TEXT,
    }),
  "turn/diff/updated": (_state, notification) =>
    actionPlan({ type: "message-stream/turn-diff-updated", turnId: notification.params.turnId, diff: notification.params.diff }),
  "hook/started": (state, notification) => hookRunPlan(state, notification.params.run, notification.params.turnId, "running"),
  "hook/completed": (state, notification) =>
    hookRunPlan(state, notification.params.run, notification.params.turnId, notification.params.run.status),
  "item/mcpToolCall/progress": (_state, notification) =>
    actionPlan({
      type: "message-stream/tool-output-appended",
      itemId: notification.params.itemId,
      turnId: notification.params.turnId,
      delta: notification.params.message,
      fallbackLabel: STREAMED_MCP_PROGRESS_LABEL,
    }),
  "item/autoApprovalReview/started": autoApprovalReviewPlan,
  "item/autoApprovalReview/completed": autoApprovalReviewPlan,
  guardianWarning: (state, notification, localItemId) => {
    const item = createReviewResultItem(localItemId("review"), notification.params.message);
    if (
      isUnstructuredAutoReviewWarning(item) &&
      hasStructuredAutoReviewResult(messageStreamItems(state.messageStream), activeTurnId(state))
    ) {
      return EMPTY_PLAN;
    }
    return actionPlan({ type: "message-stream/item-upserted", item });
  },
} satisfies ServerNotificationStatePlannerMap<StreamUpdateNotificationMethod>;

const TURN_LIFECYCLE_PLANNERS = {
  "turn/started": (state, notification) => ({
    actions: [
      {
        type: "turn/started",
        threadId: notification.params.threadId,
        turnId: notification.params.turn.id,
        items: messageStreamItemsWithPendingPromptSubmitHooks(state, notification.params.turn.id),
      },
    ],
    effects: [
      {
        type: "apply-thread-catalog-event",
        event: { type: "thread-touched", threadId: notification.params.threadId, recencyAt: notification.params.turn.startedAt },
      },
    ],
  }),
  "turn/completed": (state, notification) => {
    if (activeTurnId(state) !== notification.params.turn.id) return EMPTY_PLAN;
    return {
      actions: [
        {
          type: "turn/completed",
          turnId: notification.params.turn.id,
          status: notification.params.turn.status,
          items: completeReasoningItems(
            reconcileCompletedTurnItems({
              currentItems: messageStreamItems(state.messageStream),
              completedTurnId: notification.params.turn.id,
              turnItems: messageStreamItemsFromTurns([notification.params.turn]),
            }),
            notification.params.turn.id,
          ),
        },
      ],
      effects: [
        {
          type: "maybe-name-thread",
          threadId: notification.params.threadId,
          turnId: notification.params.turn.id,
          completedSummary: completedConversationSummaryFromAppServerTurn(notification.params.turn),
        },
        { type: "refresh-threads" },
      ],
    };
  },
} satisfies ServerNotificationStatePlannerMap<TurnLifecycleNotificationMethod>;

const THREAD_LIFECYCLE_PLANNERS = {
  "thread/started": (state, notification) => {
    const effects: ChatNotificationEffect[] = [
      {
        type: "apply-thread-catalog-event",
        event: { type: "thread-started", thread: threadFromAppServerRecord(notification.params.thread) },
      },
    ];
    if (!state.activeThread.id || state.activeThread.id === notification.params.thread.id) {
      return { actions: [{ type: "active-thread/cwd-set", cwd: notification.params.thread.cwd }], effects };
    }
    return { actions: [], effects };
  },
  "thread/archived": (_state, notification) => ({
    actions: [],
    effects: [{ type: "apply-thread-catalog-event", event: { type: "thread-archived", threadId: notification.params.threadId } }],
  }),
  "thread/deleted": (_state, notification) => ({
    actions: [],
    effects: [{ type: "apply-thread-catalog-event", event: { type: "thread-deleted", threadId: notification.params.threadId } }],
  }),
  "thread/unarchived": (_state, notification) => ({
    actions: [],
    effects: [{ type: "apply-thread-catalog-event", event: { type: "thread-unarchived", threadId: notification.params.threadId } }],
  }),
  "thread/name/updated": (_state, notification) => {
    const name = normalizeExplicitThreadName(notification.params.threadName);
    return {
      actions: [],
      effects: [{ type: "apply-thread-catalog-event", event: { type: "thread-renamed", threadId: notification.params.threadId, name } }],
    };
  },
  "thread/settings/updated": (state, notification) => {
    if (state.activeThread.id !== notification.params.threadId) return EMPTY_PLAN;
    return actionPlan(activeThreadSettingsAppliedAction(notification.params.threadSettings));
  },
  "thread/goal/updated": (state, notification, localItemId) => {
    if (state.activeThread.id !== notification.params.threadId) return EMPTY_PLAN;
    const actions: ChatAction[] = [{ type: "active-thread/goal-set", goal: notification.params.goal }];
    const item = goalChangeItem(localItemId("goal"), state.activeThread.goal, notification.params.goal);
    if (item) actions.push({ type: "message-stream/item-upserted", item });
    return { actions, effects: [] };
  },
  "thread/goal/cleared": (state, notification, localItemId) => {
    if (state.activeThread.id !== notification.params.threadId) return EMPTY_PLAN;
    const actions: ChatAction[] = [{ type: "active-thread/goal-set", goal: null }];
    const item = goalChangeItem(localItemId("goal"), state.activeThread.goal, null);
    if (item) actions.push({ type: "message-stream/item-upserted", item });
    return { actions, effects: [] };
  },
} satisfies ServerNotificationStatePlannerMap<ThreadLifecycleNotificationMethod>;

export function planChatNotification(
  state: ChatState,
  notification: ServerNotification,
  localItemId: LocalItemIdProvider,
): ChatNotificationPlan {
  const route = routeServerNotification(notification, {
    activeThreadId: state.activeThread.id,
    activeTurnId: activeTurnId(state),
  });
  switch (route.kind) {
    case "inactive":
    case "ignored":
    case "unhandled":
      return EMPTY_PLAN;
    case "streamUpdate":
      return planStreamUpdate(state, route.notification, localItemId);
    case "turnLifecycle":
      return planTurnLifecycle(state, route.notification, localItemId);
    case "threadLifecycle":
      return planThreadLifecycle(state, route.notification, localItemId);
    case "requestResolved":
      return {
        actions: [{ type: "request/resolved", requestId: route.notification.params.requestId }],
        effects: [],
      };
    case "diagnosticStatus":
      return planDiagnosticStatus(route.notification);
    case "userVisibleNotice":
      return planUserVisibleNotice(route.notification, localItemId);
  }
}

function planStreamUpdate(
  state: ChatState,
  notification: StreamUpdateNotification,
  localItemId: LocalItemIdProvider,
): ChatNotificationPlan {
  return planNotificationWithStateByMethod(state, notification, STREAM_UPDATE_PLANNERS, localItemId);
}

function planTurnLifecycle(
  state: ChatState,
  notification: TurnLifecycleNotification,
  localItemId: LocalItemIdProvider,
): ChatNotificationPlan {
  return planNotificationWithStateByMethod(state, notification, TURN_LIFECYCLE_PLANNERS, localItemId);
}

function planThreadLifecycle(
  state: ChatState,
  notification: ThreadLifecycleNotification,
  localItemId: LocalItemIdProvider,
): ChatNotificationPlan {
  return planNotificationWithStateByMethod(state, notification, THREAD_LIFECYCLE_PLANNERS, localItemId);
}

function planDiagnosticStatus(notification: DiagnosticStatusNotification): ChatNotificationPlan {
  return planNotificationByMethod(notification, DIAGNOSTIC_STATUS_PLANNERS);
}

function planUserVisibleNotice(notification: UserVisibleNoticeNotification, localItemId: LocalItemIdProvider): ChatNotificationPlan {
  return planNotificationWithLocalItemIdByMethod(notification, USER_VISIBLE_NOTICE_PLANNERS, localItemId);
}

function planNotificationByMethod<M extends ServerNotification["method"]>(
  notification: Extract<ServerNotification, { method: M }>,
  planners: ServerNotificationPlannerMap<M>,
): ChatNotificationPlan {
  const planner = planners[notification.method];
  return planner(notification);
}

function planNotificationWithLocalItemIdByMethod<M extends ServerNotification["method"]>(
  notification: Extract<ServerNotification, { method: M }>,
  planners: ServerNotificationLocalPlannerMap<M>,
  localItemId: LocalItemIdProvider,
): ChatNotificationPlan {
  const planner = planners[notification.method];
  return planner(notification, localItemId);
}

function planNotificationWithStateByMethod<M extends ServerNotification["method"]>(
  state: ChatState,
  notification: Extract<ServerNotification, { method: M }>,
  planners: ServerNotificationStatePlannerMap<M>,
  localItemId: LocalItemIdProvider,
): ChatNotificationPlan {
  const planner = planners[notification.method];
  return planner(state, notification, localItemId);
}

function jsonNoticePlan(
  notification: Extract<ServerNotification, { method: Exclude<UserVisibleNoticeNotificationMethod, "thread/compacted"> }>,
  localItemId: LocalItemIdProvider,
): ChatNotificationPlan {
  return systemMessagePlan({ id: localItemId("system"), text: `${notification.method}: ${jsonPreview(notification.params)}` });
}

function autoApprovalReviewPlan(
  state: ChatState,
  notification: Extract<ServerNotification, { method: "item/autoApprovalReview/started" | "item/autoApprovalReview/completed" }>,
): ChatNotificationPlan {
  const reviewItem = createAutoReviewResultItem(notification.params);
  return actionPlan({
    type: "message-stream/items-replaced",
    items: upsertMessageStreamItemById(
      messageStreamItems(state.messageStream).filter((item) => !isUnstructuredAutoReviewWarning(item)),
      reviewItem,
    ),
  });
}

function startedItemPlan(item: AppServerTurnItem, turnId: string): ChatNotificationPlan {
  if (shouldSuppressLifecycleItem(item)) return EMPTY_PLAN;
  const streamItem = messageStreamItemFromTurnItem(item, turnId);
  return streamItem ? actionPlan({ type: "message-stream/item-upserted", item: streamItem }) : EMPTY_PLAN;
}

function completedItemPlan(item: AppServerTurnItem, turnId: string): ChatNotificationPlan {
  if (item.type === "userMessage") return EMPTY_PLAN;
  const streamItem = messageStreamItemFromTurnItem(item, turnId);
  if (!streamItem) return EMPTY_PLAN;
  return {
    actions: [
      { type: "message-stream/item-upserted", item: streamItem },
      ...(streamItem.kind === "reasoning" ? ([{ type: "message-stream/reasoning-completed", turnId }] satisfies ChatAction[]) : []),
    ],
    effects: [],
  };
}

function fileChangePlan(itemId: string, turnId: string, changes: readonly AppServerFileChange[], status: string): ChatNotificationPlan {
  return actionPlan({
    type: "message-stream/item-upserted",
    item: streamingFileChangeMessageStreamItem(itemId, turnId, normalizeFileChanges(changes), status),
  });
}

function appendToolTextPlan(
  _state: ChatState,
  itemId: string,
  turnId: string,
  label: string,
  delta: string,
  kind: Extract<MessageStreamItemKind, "tool" | "hook" | "reasoning"> = "tool",
): ChatNotificationPlan {
  return actionPlan({
    type: "message-stream/item-text-appended",
    itemId,
    turnId,
    label,
    delta,
    kind,
  });
}

function hookRunPlan(
  state: ChatState,
  run: Extract<ServerNotification, { method: "hook/started" }>["params"]["run"],
  turnId: string | null,
  status: string,
): ChatNotificationPlan {
  const resolvedTurnId = hookRunTurnId(state, run, turnId);
  const item = hookRunMessageStreamItem(run, resolvedTurnId, status);
  if (!item) return EMPTY_PLAN;
  const currentPendingTurnStart = pendingTurnStartForState(state);
  let pendingTurnStart = currentPendingTurnStart;
  if (!resolvedTurnId && currentPendingTurnStart && run.eventName === "userPromptSubmit") {
    const hookIds = currentPendingTurnStart.promptSubmitHookItemIds;
    pendingTurnStart = hookIds.includes(item.id)
      ? currentPendingTurnStart
      : { ...currentPendingTurnStart, promptSubmitHookItemIds: [...hookIds, item.id] };
  }
  return actionPlan({
    type: "turn/pending-start-hook-upserted",
    item,
    pendingTurnStart,
  });
}

function hookRunTurnId(
  state: ChatState,
  run: Extract<ServerNotification, { method: "hook/started" }>["params"]["run"],
  turnId: string | null,
): string | null {
  if (turnId) return turnId;
  if (run.eventName === "userPromptSubmit" && !pendingTurnStartForState(state)) return activeTurnId(state);
  return null;
}

function messageStreamItemsWithPendingPromptSubmitHooks(state: ChatState, turnId: string): readonly MessageStreamItem[] {
  const pending = pendingTurnStartForState(state);
  const items = messageStreamItems(state.messageStream);
  if (!pending) return items;
  return attachHookRunsToTurn(items, turnId, pending.promptSubmitHookItemIds, pending.anchorItemId);
}

function hasStructuredAutoReviewResult(items: readonly MessageStreamItem[], activeTurnId: string | null): boolean {
  return items.some(
    (item) =>
      item.kind === "reviewResult" &&
      Boolean(item.turnId) &&
      (!activeTurnId || item.turnId === activeTurnId) &&
      isAutoReviewText(item.text),
  );
}

function isUnstructuredAutoReviewWarning(item: MessageStreamItem): boolean {
  return item.kind === "reviewResult" && !item.turnId && isAutoReviewText(item.text);
}

function isAutoReviewText(text: string): boolean {
  return /^Auto-review\b/i.test(text.trim());
}

function systemMessagePlan(message: { id: string; text: string }): ChatNotificationPlan {
  return actionPlan({ type: "message-stream/system-item-added", item: createSystemItem(message.id, message.text) });
}

function actionPlan(action: ChatAction): ChatNotificationPlan {
  return { actions: [action], effects: [] };
}
