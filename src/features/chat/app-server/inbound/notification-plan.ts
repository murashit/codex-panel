import { activeThreadSettingsAppliedAction } from "../../application/state/actions";
import type { McpServerStartupStatus } from "../../../../domain/server/diagnostics";
import { threadTokenUsageFromRuntimeUsage } from "../../../../domain/runtime/metrics";
import type { FileUpdateChange } from "../../../../app-server/protocol/file-change";
import { completedConversationSummaryFromTurnRecord, type TurnItem, type TurnRecord } from "../../../../app-server/protocol/turn";
import type { ServerNotification } from "../../../../app-server/connection/rpc-messages";
import { normalizeExplicitThreadName } from "../../../../domain/threads/model";
import type { ThreadConversationSummary } from "../../../../domain/threads/transcript";
import { jsonPreview } from "../../../../utils";
import {
  activeTurnId,
  pendingTurnStart as pendingTurnStartForState,
  type ChatAction,
  type ChatState,
} from "../../application/state/root-reducer";
import { completeReasoningItems, upsertMessageStreamItemById } from "../../domain/message-stream/updates";
import {
  messageStreamItemFromTurnItem,
  messageStreamItemsFromTurns,
  shouldSuppressLifecycleItem,
} from "../mappers/message-stream/turn-items";
import { taskProgressMessageStreamItem } from "../../domain/message-stream/factories/task-progress";
import type { MessageStreamItem, MessageStreamItemKind, MessageStreamMessageItem } from "../../domain/message-stream/items";
import { goalChangeItem } from "../../domain/message-stream/factories/goal-items";
import { hookRunMessageStreamItem } from "../mappers/message-stream/hook-run-items";
import { createAutoReviewResultItem, createReviewResultItem } from "../mappers/message-stream/review-result-items";
import { createSystemItem } from "../../domain/message-stream/factories/system-items";
import {
  STREAMED_COMMAND_RUNNING_TEXT,
  STREAMED_FILE_CHANGE_IN_PROGRESS_TEXT,
  STREAMED_MCP_PROGRESS_LABEL,
} from "../../domain/message-stream/factories/streaming-items";
import { streamingFileChangeMessageStreamItem } from "../mappers/message-stream/streaming-items";
import { attachHookRunsToTurn } from "../../domain/message-stream/updates";
import { messageStreamItems } from "../../application/state/message-stream";
import { isLocalUserMessageId } from "../../domain/local-id";
import {
  routeServerNotification,
  type DiagnosticStatusNotificationMethod,
  type StreamUpdateNotificationMethod,
  type ThreadLifecycleNotificationMethod,
  type TurnLifecycleNotificationMethod,
  type UserVisibleNoticeNotificationMethod,
} from "./routing";

export type ChatNotificationEffect =
  | { type: "refresh-threads" }
  | { type: "refresh-rate-limits" }
  | { type: "refresh-skills"; forceReload: boolean }
  | { type: "publish-app-server-metadata" }
  | { type: "maybe-name-thread"; threadId: string; turnId: string; completedSummary: ThreadConversationSummary | null }
  | { type: "notify-thread-archived"; threadId: string }
  | { type: "notify-thread-renamed"; threadId: string; name: string | null }
  | {
      type: "record-mcp-startup-status";
      name: string;
      status: McpServerStartupStatus;
      message: string | null;
    };

export interface ChatNotificationPlan {
  actions: readonly ChatAction[];
  effects: readonly ChatNotificationEffect[];
}

export type LocalItemIdFactory = (prefix: string) => string;

const EMPTY_PLAN: ChatNotificationPlan = { actions: [], effects: [] };
const MESSAGE_CONTEXT_COMPACTED = "Context compacted.";

type ServerNotificationPlanner<M extends ServerNotification["method"]> = (
  notification: Extract<ServerNotification, { method: M }>,
) => ChatNotificationPlan;
type ServerNotificationPlannerMap<M extends ServerNotification["method"]> = { [Method in M]: ServerNotificationPlanner<Method> };
type ServerNotificationLocalPlanner<M extends ServerNotification["method"]> = (
  notification: Extract<ServerNotification, { method: M }>,
  localItemId: LocalItemIdFactory,
) => ChatNotificationPlan;
type ServerNotificationLocalPlannerMap<M extends ServerNotification["method"]> = {
  [Method in M]: ServerNotificationLocalPlanner<Method>;
};
type ServerNotificationStatePlanner<M extends ServerNotification["method"]> = (
  state: ChatState,
  notification: Extract<ServerNotification, { method: M }>,
  localItemId: LocalItemIdFactory,
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
  "account/rateLimits/updated": () => ({ actions: [], effects: [{ type: "refresh-rate-limits" }] }),
  "skills/changed": () => ({ actions: [], effects: [{ type: "refresh-skills", forceReload: true }] }),
  "mcpServer/startupStatus/updated": (notification) => ({
    actions: [],
    effects:
      notification.params.name.length === 0
        ? [{ type: "publish-app-server-metadata" }]
        : [
            {
              type: "record-mcp-startup-status",
              name: notification.params.name,
              status: notification.params.status,
              message: notification.params.error,
            },
            { type: "publish-app-server-metadata" },
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
  "item/completed": (state, notification) => completedItemPlan(state, notification.params.item, notification.params.turnId),
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
  "turn/started": (state, notification) =>
    actionPlan({
      type: "turn/started",
      threadId: notification.params.threadId,
      turnId: notification.params.turn.id,
      items: messageStreamItemsWithPendingPromptSubmitHooks(state, notification.params.turn.id),
    }),
  "turn/completed": (state, notification) => {
    if (activeTurnId(state) !== notification.params.turn.id) return EMPTY_PLAN;
    return {
      actions: [
        {
          type: "turn/completed",
          turnId: notification.params.turn.id,
          status: notification.params.turn.status,
          items: completeReasoningItems(reconciledCompletedTurnItems(state, notification.params.turn), notification.params.turn.id),
        },
      ],
      effects: [
        {
          type: "maybe-name-thread",
          threadId: notification.params.threadId,
          turnId: notification.params.turn.id,
          completedSummary: completedConversationSummaryFromTurnRecord(notification.params.turn),
        },
        { type: "refresh-threads" },
      ],
    };
  },
} satisfies ServerNotificationStatePlannerMap<TurnLifecycleNotificationMethod>;

const THREAD_LIFECYCLE_PLANNERS = {
  "thread/started": (state, notification) => {
    if (!state.activeThread.id || state.activeThread.id === notification.params.thread.id) {
      return actionPlan({ type: "active-thread/cwd-set", cwd: notification.params.thread.cwd });
    }
    return EMPTY_PLAN;
  },
  "thread/archived": (state, notification) => ({
    actions: [
      {
        type: "thread-list/applied",
        threads: state.threadList.listedThreads.filter((thread) => thread.id !== notification.params.threadId),
      },
      ...(state.activeThread.id === notification.params.threadId ? ([{ type: "active-thread/cleared" }] satisfies ChatAction[]) : []),
    ],
    effects: [{ type: "notify-thread-archived", threadId: notification.params.threadId }],
  }),
  "thread/unarchived": () => ({ actions: [], effects: [{ type: "refresh-threads" }] }),
  "thread/name/updated": (state, notification) => {
    const name = normalizeExplicitThreadName(notification.params.threadName);
    return {
      actions: [
        {
          type: "thread-list/applied",
          threads: state.threadList.listedThreads.map((thread) =>
            thread.id === notification.params.threadId ? { ...thread, name } : thread,
          ),
        },
      ],
      effects: [{ type: "notify-thread-renamed", threadId: notification.params.threadId, name }],
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
  localItemId: LocalItemIdFactory,
): ChatNotificationPlan {
  const route = routeServerNotification(notification, {
    activeThreadId: state.activeThread.id,
    activeTurnId: activeTurnId(state),
  });
  switch (route.kind) {
    case "inactive":
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

function planStreamUpdate(state: ChatState, notification: ServerNotification, localItemId: LocalItemIdFactory): ChatNotificationPlan {
  return planNotificationWithStateByMethod(state, notification, STREAM_UPDATE_PLANNERS, localItemId);
}

function planTurnLifecycle(state: ChatState, notification: ServerNotification, localItemId: LocalItemIdFactory): ChatNotificationPlan {
  return planNotificationWithStateByMethod(state, notification, TURN_LIFECYCLE_PLANNERS, localItemId);
}

function planThreadLifecycle(state: ChatState, notification: ServerNotification, localItemId: LocalItemIdFactory): ChatNotificationPlan {
  return planNotificationWithStateByMethod(state, notification, THREAD_LIFECYCLE_PLANNERS, localItemId);
}

function planDiagnosticStatus(notification: ServerNotification): ChatNotificationPlan {
  return planNotificationByMethod(notification, DIAGNOSTIC_STATUS_PLANNERS);
}

function planUserVisibleNotice(notification: ServerNotification, localItemId: LocalItemIdFactory): ChatNotificationPlan {
  return planNotificationWithLocalItemIdByMethod(notification, USER_VISIBLE_NOTICE_PLANNERS, localItemId);
}

function planNotificationByMethod<M extends ServerNotification["method"]>(
  notification: ServerNotification,
  planners: ServerNotificationPlannerMap<M>,
): ChatNotificationPlan {
  const planner = (planners as Partial<Record<ServerNotification["method"], (notification: ServerNotification) => ChatNotificationPlan>>)[
    notification.method
  ];
  return planner ? planner(notification) : EMPTY_PLAN;
}

function planNotificationWithLocalItemIdByMethod<M extends ServerNotification["method"]>(
  notification: ServerNotification,
  planners: ServerNotificationLocalPlannerMap<M>,
  localItemId: LocalItemIdFactory,
): ChatNotificationPlan {
  const planner = (
    planners as Partial<
      Record<ServerNotification["method"], (notification: ServerNotification, localItemId: LocalItemIdFactory) => ChatNotificationPlan>
    >
  )[notification.method];
  return planner ? planner(notification, localItemId) : EMPTY_PLAN;
}

function planNotificationWithStateByMethod<M extends ServerNotification["method"]>(
  state: ChatState,
  notification: ServerNotification,
  planners: ServerNotificationStatePlannerMap<M>,
  localItemId: LocalItemIdFactory,
): ChatNotificationPlan {
  const planner = (
    planners as Partial<
      Record<
        ServerNotification["method"],
        (state: ChatState, notification: ServerNotification, localItemId: LocalItemIdFactory) => ChatNotificationPlan
      >
    >
  )[notification.method];
  return planner ? planner(state, notification, localItemId) : EMPTY_PLAN;
}

function jsonNoticePlan(
  notification: Extract<ServerNotification, { method: Exclude<UserVisibleNoticeNotificationMethod, "thread/compacted"> }>,
  localItemId: LocalItemIdFactory,
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
    items: upsertMessageStreamItemById(removeUnstructuredAutoReviewWarnings(messageStreamItems(state.messageStream)), reviewItem),
  });
}

function startedItemPlan(item: TurnItem, turnId: string): ChatNotificationPlan {
  if (shouldSuppressLifecycleItem(item)) return EMPTY_PLAN;
  const streamItem = messageStreamItemFromTurnItem(item, turnId);
  return streamItem ? actionPlan({ type: "message-stream/item-upserted", item: streamItem }) : EMPTY_PLAN;
}

function completedItemPlan(state: ChatState, item: TurnItem, turnId: string): ChatNotificationPlan {
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

function fileChangePlan(itemId: string, turnId: string, changes: FileUpdateChange[], status: string): ChatNotificationPlan {
  return actionPlan({
    type: "message-stream/item-upserted",
    item: streamingFileChangeMessageStreamItem(itemId, turnId, changes, status),
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

function reconciledCompletedTurnItems(state: ChatState, turn: TurnRecord): readonly MessageStreamItem[] {
  const turnItems = messageStreamItemsFromTurns([turn]);
  const items = messageStreamItems(state.messageStream);
  if (turnItems.length === 0) return items;
  const serverUserMessages = turnItems.filter(isUserMessage);
  const serverUserClientIds = new Set(serverUserMessages.map((item) => item.clientId).filter(isString));
  const serverUserMessagesByClientId = new Map(
    serverUserMessages.flatMap((item) => (item.clientId ? ([[item.clientId, item]] as const) : [])),
  );
  const serverUserFallbackTexts = serverUserClientIds.size > 0 ? new Set<string>() : new Set(serverUserMessages.map((item) => item.text));
  const stateMessageStreamItems = items.map((item) => serverUserMessageForOptimisticItem(item, serverUserMessagesByClientId) ?? item);
  let mergedTurnItems = stateMessageStreamItems
    .filter((item) => item.turnId === turn.id)
    .filter((item) => !isReconciledOptimisticUserMessage(item, turn.id, serverUserClientIds, serverUserFallbackTexts));
  for (const item of turnItems) {
    mergedTurnItems = upsertMessageStreamItemById(mergedTurnItems, item);
  }
  const retainedItems = stateMessageStreamItems
    .filter((item) => item.turnId !== turn.id)
    .filter((item) => !isReconciledOptimisticUserMessage(item, turn.id, serverUserClientIds, serverUserFallbackTexts));
  return [...retainedItems, ...mergedTurnItems];
}

function removeUnstructuredAutoReviewWarnings(items: readonly MessageStreamItem[]): MessageStreamItem[] {
  return items.filter((item) => !isUnstructuredAutoReviewWarning(item));
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

function isUserMessage(item: MessageStreamItem): item is MessageStreamMessageItem & { role: "user" } {
  return item.kind === "message" && item.role === "user";
}

function serverUserMessageForOptimisticItem(
  item: MessageStreamItem,
  serverUserMessagesByClientId: ReadonlyMap<string, MessageStreamMessageItem & { role: "user" }>,
): (MessageStreamMessageItem & { role: "user" }) | null {
  if (!isUserMessage(item) || !isLocalUserMessageId(item.id)) return null;
  return serverUserMessagesByClientId.get(item.id) ?? null;
}

function isReconciledOptimisticUserMessage(
  item: MessageStreamItem,
  completedTurnId: string,
  serverUserClientIds: Set<string>,
  serverUserFallbackTexts: Set<string>,
): boolean {
  if (!isUserMessage(item) || !isLocalUserMessageId(item.id)) return false;
  return serverUserClientIds.has(item.id) || isFallbackOptimisticUserMessageForTurn(item, completedTurnId, serverUserFallbackTexts);
}

function isFallbackOptimisticUserMessageForTurn(
  item: MessageStreamMessageItem & { role: "user" },
  completedTurnId: string,
  serverUserFallbackTexts: Set<string>,
): boolean {
  if (serverUserFallbackTexts.size === 0) return false;
  if (item.turnId && item.turnId !== completedTurnId) return false;
  return serverUserFallbackTexts.has(item.copyText ?? item.text);
}

function isString(value: string | null | undefined): value is string {
  return typeof value === "string";
}

function systemMessagePlan(message: { id: string; text: string }): ChatNotificationPlan {
  return actionPlan({ type: "message-stream/system-item-added", item: createSystemItem(message.id, message.text) });
}

function actionPlan(action: ChatAction): ChatNotificationPlan {
  return { actions: [action], effects: [] };
}
