import { activeThreadSettingsAppliedAction } from "../../state/actions";
import type { McpServerStartupStatus } from "../../../../app-server/diagnostics";
import { threadTokenUsageFromAppServerUsage } from "../../../../app-server/runtime-metrics";
import {
  completedConversationSummaryFromAppServerTurn,
  type AppServerFileUpdateChange,
  type AppServerThreadItem,
  type AppServerTurn,
} from "../../../../app-server/turn-model";
import type { ServerNotification } from "../../../../app-server/types";
import type { ThreadConversationSummary } from "../../../../domain/threads/transcript";
import { jsonPreview } from "../../../../utils";
import { activeTurnId, pendingTurnStart as pendingTurnStartForState, type ChatAction, type ChatState } from "../../state/reducer";
import { createAutoReviewResultItem, createReviewResultItem } from "../../display/items/review-result";
import {
  appendAssistantDelta,
  appendItemOutput,
  appendItemText,
  appendPlanDelta,
  appendToolOutput,
  completeReasoningItems,
  upsertDisplayItem,
} from "../../state/transcript-updates";
import { displayItemFromThreadItem, displayItemsFromTurns, normalizeFileChanges, shouldSuppressLifecycleItem } from "../../display/turn-items";
import { taskProgressDisplayItem } from "../../display/items/task-progress";
import { createSystemItem } from "../../display/items/system";
import type { DisplayItem, DisplayKind, MessageDisplayItem } from "../../display/types";
import { goalChangeItem } from "../../display/items/goal";
import { hookRunDisplayItem } from "../../display/items/hook-run";
import { attachHookRunsToTurn } from "../../state/transcript-updates";
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
      tokenUsage: threadTokenUsageFromAppServerUsage(notification.params.tokenUsage),
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
  "thread/compacted": (_notification, localItemId) => systemMessagePlan({ id: localItemId("system"), text: "Context compacted." }),
  "model/rerouted": jsonNoticePlan,
  deprecationNotice: jsonNoticePlan,
  error: jsonNoticePlan,
  warning: jsonNoticePlan,
  configWarning: jsonNoticePlan,
} satisfies ServerNotificationLocalPlannerMap<UserVisibleNoticeNotificationMethod>;

const STREAM_UPDATE_PLANNERS = {
  "item/agentMessage/delta": (state, notification) => {
    const { params } = notification;
    const displayItems = appendAssistantDelta(
      completeReasoningItems(state.transcript.displayItems, params.turnId),
      params.itemId,
      params.turnId,
      params.delta,
    );
    return actionPlan({ type: "transcript/items-replaced", items: displayItems });
  },
  "item/plan/delta": (state, notification) => {
    const { params } = notification;
    return actionPlan({
      type: "transcript/items-replaced",
      items: appendPlanDelta(state.transcript.displayItems, params.itemId, params.turnId, params.delta),
    });
  },
  "turn/plan/updated": (_state, notification) =>
    actionPlan({
      type: "transcript/item-upserted",
      item: taskProgressDisplayItem(notification.params.turnId, notification.params.explanation, notification.params.plan),
    }),
  "item/reasoning/summaryTextDelta": (state, notification) =>
    appendToolTextPlan(state, notification.params.itemId, notification.params.turnId, "reasoning", notification.params.delta, "reasoning"),
  "item/reasoning/textDelta": (state, notification) =>
    appendToolTextPlan(state, notification.params.itemId, notification.params.turnId, "reasoning", notification.params.delta, "reasoning"),
  "item/reasoning/summaryPartAdded": (state, notification) =>
    appendToolTextPlan(state, notification.params.itemId, notification.params.turnId, "reasoning", "", "reasoning"),
  "item/started": (_state, notification) => startedItemPlan(notification.params.item, notification.params.turnId),
  "item/completed": (state, notification) => completedItemPlan(state, notification.params.item, notification.params.turnId),
  "item/commandExecution/outputDelta": (state, notification) =>
    actionPlan({
      type: "transcript/items-replaced",
      items: appendItemOutput(
        state.transcript.displayItems,
        notification.params.itemId,
        notification.params.turnId,
        notification.params.delta,
        "command",
        "Command running",
      ),
    }),
  "item/fileChange/patchUpdated": (_state, notification) =>
    fileChangePlan(notification.params.itemId, notification.params.turnId, notification.params.changes, "inProgress"),
  "item/fileChange/outputDelta": (state, notification) =>
    actionPlan({
      type: "transcript/items-replaced",
      items: appendItemOutput(
        state.transcript.displayItems,
        notification.params.itemId,
        notification.params.turnId,
        notification.params.delta,
        "fileChange",
        "File change inProgress",
      ),
    }),
  "turn/diff/updated": (_state, notification) =>
    actionPlan({ type: "transcript/turn-diff-updated", turnId: notification.params.turnId, diff: notification.params.diff }),
  "hook/started": (state, notification) => hookRunPlan(state, notification.params.run, notification.params.turnId, "running"),
  "hook/completed": (state, notification) =>
    hookRunPlan(state, notification.params.run, notification.params.turnId, notification.params.run.status),
  "item/mcpToolCall/progress": (state, notification) =>
    actionPlan({
      type: "transcript/items-replaced",
      items: appendToolOutput(
        state.transcript.displayItems,
        notification.params.itemId,
        notification.params.turnId,
        notification.params.message,
        "mcp progress",
      ),
    }),
  "item/autoApprovalReview/started": autoApprovalReviewPlan,
  "item/autoApprovalReview/completed": autoApprovalReviewPlan,
  guardianWarning: (state, notification, localItemId) => {
    const item = createReviewResultItem(localItemId("review"), notification.params.message);
    if (isUnstructuredAutoReviewWarning(item) && hasStructuredAutoReviewResult(state.transcript.displayItems, activeTurnId(state))) {
      return EMPTY_PLAN;
    }
    return actionPlan({ type: "transcript/item-upserted", item });
  },
} satisfies ServerNotificationStatePlannerMap<StreamUpdateNotificationMethod>;

const TURN_LIFECYCLE_PLANNERS = {
  "turn/started": (state, notification) =>
    actionPlan({
      type: "turn/started",
      threadId: notification.params.threadId,
      turnId: notification.params.turn.id,
      displayItems: displayItemsWithPendingPromptSubmitHooks(state, notification.params.turn.id),
    }),
  "turn/completed": (state, notification) => {
    if (activeTurnId(state) !== notification.params.turn.id) return EMPTY_PLAN;
    return {
      actions: [
        {
          type: "turn/completed",
          turnId: notification.params.turn.id,
          status: notification.params.turn.status,
          displayItems: completeReasoningItems(reconciledCompletedTurnItems(state, notification.params.turn), notification.params.turn.id),
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
    const name =
      typeof notification.params.threadName === "string" && notification.params.threadName.trim()
        ? notification.params.threadName.trim()
        : null;
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
    if (item) actions.push({ type: "transcript/item-upserted", item });
    return { actions, effects: [] };
  },
  "thread/goal/cleared": (state, notification, localItemId) => {
    if (state.activeThread.id !== notification.params.threadId) return EMPTY_PLAN;
    const actions: ChatAction[] = [{ type: "active-thread/goal-set", goal: null }];
    const item = goalChangeItem(localItemId("goal"), state.activeThread.goal, null);
    if (item) actions.push({ type: "transcript/item-upserted", item });
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
    type: "transcript/items-replaced",
    items: upsertDisplayItem(removeUnstructuredAutoReviewWarnings(state.transcript.displayItems), reviewItem),
  });
}

function startedItemPlan(item: AppServerThreadItem, turnId: string): ChatNotificationPlan {
  if (shouldSuppressLifecycleItem(item)) return EMPTY_PLAN;
  const displayItem = displayItemFromThreadItem(item, turnId);
  return displayItem ? actionPlan({ type: "transcript/item-upserted", item: displayItem }) : EMPTY_PLAN;
}

function completedItemPlan(state: ChatState, item: AppServerThreadItem, turnId: string): ChatNotificationPlan {
  if (item.type === "userMessage") return EMPTY_PLAN;
  const displayItem = displayItemFromThreadItem(item, turnId);
  if (!displayItem) return EMPTY_PLAN;
  let displayItems = upsertDisplayItem(state.transcript.displayItems, displayItem);
  if (displayItem.kind === "reasoning") {
    displayItems = completeReasoningItems(displayItems, turnId);
  }
  return actionPlan({ type: "transcript/items-replaced", items: displayItems });
}

function fileChangePlan(itemId: string, turnId: string, changes: AppServerFileUpdateChange[], status: string): ChatNotificationPlan {
  return actionPlan({
    type: "transcript/item-upserted",
    item: {
      id: itemId,
      kind: "fileChange",
      role: "tool",
      text: `File change ${status}`,
      turnId,
      sourceItemId: itemId,
      status,
      changes: normalizeFileChanges(changes),
    },
  });
}

function appendToolTextPlan(
  state: ChatState,
  itemId: string,
  turnId: string,
  label: string,
  delta: string,
  kind: Extract<DisplayKind, "tool" | "hook" | "reasoning"> = "tool",
): ChatNotificationPlan {
  return actionPlan({
    type: "transcript/items-replaced",
    items: appendItemText(state.transcript.displayItems, itemId, turnId, label, delta, kind),
  });
}

function hookRunPlan(
  state: ChatState,
  run: Extract<ServerNotification, { method: "hook/started" }>["params"]["run"],
  turnId: string | null,
  status: string,
): ChatNotificationPlan {
  const resolvedTurnId = hookRunTurnId(state, run, turnId);
  const item = hookRunDisplayItem(run, resolvedTurnId, status);
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

function displayItemsWithPendingPromptSubmitHooks(state: ChatState, turnId: string): readonly DisplayItem[] {
  const pending = pendingTurnStartForState(state);
  if (!pending) return state.transcript.displayItems;
  return attachHookRunsToTurn(state.transcript.displayItems, turnId, pending.promptSubmitHookItemIds, pending.anchorItemId);
}

function reconciledCompletedTurnItems(state: ChatState, turn: AppServerTurn): readonly DisplayItem[] {
  const turnItems = displayItemsFromTurns([turn]);
  if (turnItems.length === 0) return state.transcript.displayItems;
  const serverUserMessages = turnItems.filter(isUserMessage);
  const serverUserClientIds = new Set(serverUserMessages.map((item) => item.clientId).filter(isString));
  const serverUserMessagesByClientId = new Map(
    serverUserMessages.flatMap((item) => (item.clientId ? ([[item.clientId, item]] as const) : [])),
  );
  const serverUserFallbackTexts = serverUserClientIds.size > 0 ? new Set<string>() : new Set(serverUserMessages.map((item) => item.text));
  const stateDisplayItems = state.transcript.displayItems.map(
    (item) => serverUserMessageForOptimisticItem(item, serverUserMessagesByClientId) ?? item,
  );
  let mergedTurnItems = stateDisplayItems
    .filter((item) => item.turnId === turn.id)
    .filter((item) => !isOptimisticUserMessage(item, serverUserClientIds, serverUserFallbackTexts));
  for (const item of turnItems) {
    mergedTurnItems = upsertDisplayItem(mergedTurnItems, item);
  }
  const retainedItems = stateDisplayItems
    .filter((item) => item.turnId !== turn.id)
    .filter((item) => !isOptimisticUserMessage(item, serverUserClientIds, serverUserFallbackTexts));
  return [...retainedItems, ...mergedTurnItems];
}

function removeUnstructuredAutoReviewWarnings(items: readonly DisplayItem[]): DisplayItem[] {
  return items.filter((item) => !isUnstructuredAutoReviewWarning(item));
}

function hasStructuredAutoReviewResult(items: readonly DisplayItem[], activeTurnId: string | null): boolean {
  return items.some(
    (item) =>
      item.kind === "reviewResult" &&
      Boolean(item.turnId) &&
      (!activeTurnId || item.turnId === activeTurnId) &&
      isAutoReviewText(item.text),
  );
}

function isUnstructuredAutoReviewWarning(item: DisplayItem): boolean {
  return item.kind === "reviewResult" && !item.turnId && isAutoReviewText(item.text);
}

function isAutoReviewText(text: string): boolean {
  return /^Auto-review\b/i.test(text.trim());
}

function isUserMessage(item: DisplayItem): item is MessageDisplayItem & { role: "user" } {
  return item.kind === "message" && item.role === "user";
}

function serverUserMessageForOptimisticItem(
  item: DisplayItem,
  serverUserMessagesByClientId: ReadonlyMap<string, MessageDisplayItem & { role: "user" }>,
): (MessageDisplayItem & { role: "user" }) | null {
  if (!isUserMessage(item) || !isLocalUserMessageId(item.id)) return null;
  return serverUserMessagesByClientId.get(item.id) ?? null;
}

function isOptimisticUserMessage(item: DisplayItem, serverUserClientIds: Set<string>, serverUserFallbackTexts: Set<string>): boolean {
  if (!isUserMessage(item) || !isLocalUserMessageId(item.id)) return false;
  return serverUserClientIds.has(item.id) || serverUserFallbackTexts.has(item.text);
}

function isLocalUserMessageId(id: string): boolean {
  return id.startsWith("local-user-") || id.startsWith("local-steer-");
}

function isString(value: string | null | undefined): value is string {
  return typeof value === "string";
}

function systemMessagePlan(message: { id: string; text: string }): ChatNotificationPlan {
  return actionPlan({ type: "transcript/system-item-added", item: createSystemItem(message.id, message.text) });
}

function actionPlan(action: ChatAction): ChatNotificationPlan {
  return { actions: [action], effects: [] };
}
