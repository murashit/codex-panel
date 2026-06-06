import { parseServiceTier } from "../../app-server/service-tier";
import type { ServerNotification } from "../../generated/app-server/ServerNotification";
import type { FileUpdateChange } from "../../generated/app-server/v2/FileUpdateChange";
import type { ThreadItem } from "../../generated/app-server/v2/ThreadItem";
import type { Turn } from "../../generated/app-server/v2/Turn";
import { jsonPreview } from "../../utils";
import { activeTurnId, pendingTurnStart as pendingTurnStartForState, type ChatAction, type ChatState } from "./chat-state";
import { createAutoReviewResultItem, createReviewResultItem } from "./display/review";
import {
  appendAssistantDelta,
  appendItemOutput,
  appendItemText,
  appendPlanDelta,
  appendToolOutput,
  completeReasoningItems,
  upsertDisplayItem,
} from "./display/stream-updates";
import {
  displayItemFromThreadItem,
  displayItemsFromTurns,
  normalizeFileChanges,
  shouldSuppressLifecycleItem,
} from "./display/thread-items";
import type { DisplayItem, DisplayKind, MessageDisplayItem } from "./display/types";
import { planProgressDisplayItem } from "./display/plan";
import { createSystemItem } from "./display/system";
import { goalChangeItem } from "./goal-messages";
import { attachHookRunsToTurn, hookRunDisplayItem } from "./hook-display";
import { routeServerNotification } from "./inbound-routing";

export type ChatNotificationEffect =
  | { type: "refresh-threads" }
  | { type: "refresh-rate-limits" }
  | { type: "refresh-skills"; forceReload: boolean }
  | { type: "publish-app-server-metadata" }
  | { type: "maybe-name-thread"; threadId: string; turn: Turn }
  | { type: "notify-thread-archived"; threadId: string }
  | { type: "notify-thread-renamed"; threadId: string; name: string | null }
  | {
      type: "record-mcp-startup-status";
      name: string;
      status: "starting" | "ready" | "failed" | "cancelled";
      message: string | null;
    };

export interface ChatNotificationPlan {
  actions: readonly ChatAction[];
  effects: readonly ChatNotificationEffect[];
}

export type LocalItemIdFactory = (prefix: string) => string;

const EMPTY_PLAN: ChatNotificationPlan = { actions: [], effects: [] };

export function planChatNotification(
  state: ChatState,
  notification: ServerNotification,
  localItemId: LocalItemIdFactory,
): ChatNotificationPlan {
  const route = routeServerNotification(notification, {
    activeThreadId: state.activeThreadId,
    activeTurnId: activeTurnId(state),
  });
  switch (route.kind) {
    case "inactive":
    case "unhandled":
      return EMPTY_PLAN;
    case "streamUpdate":
      return planStreamUpdate(state, route.notification, localItemId);
    case "turnLifecycle":
      return planTurnLifecycle(state, route.notification);
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
  const { method, params } = notification;
  if (method === "item/agentMessage/delta") {
    const displayItems = appendAssistantDelta(
      completeReasoningItems(state.displayItems, params.turnId),
      params.itemId,
      params.turnId,
      params.delta,
    );
    return actionPlan({ type: "display/items-replaced", items: displayItems });
  }
  if (method === "item/plan/delta") {
    return actionPlan({
      type: "display/items-replaced",
      items: appendPlanDelta(state.displayItems, params.itemId, params.turnId, params.delta),
    });
  }
  if (method === "turn/plan/updated") {
    return actionPlan({ type: "display/item-upserted", item: planProgressDisplayItem(params.turnId, params.explanation, params.plan) });
  }
  if (method === "item/reasoning/summaryTextDelta") {
    return appendToolTextPlan(state, params.itemId, params.turnId, "reasoning", params.delta, "reasoning");
  }
  if (method === "item/reasoning/textDelta") {
    return appendToolTextPlan(state, params.itemId, params.turnId, "reasoning", params.delta, "reasoning");
  }
  if (method === "item/reasoning/summaryPartAdded") {
    return appendToolTextPlan(state, params.itemId, params.turnId, "reasoning", "", "reasoning");
  }
  if (method === "item/started") {
    return startedItemPlan(params.item, params.turnId);
  }
  if (method === "item/completed") {
    return completedItemPlan(state, params.item, params.turnId);
  }
  if (method === "item/commandExecution/outputDelta") {
    return actionPlan({
      type: "display/items-replaced",
      items: appendItemOutput(state.displayItems, params.itemId, params.turnId, params.delta, "command", "Command running"),
    });
  }
  if (method === "item/fileChange/patchUpdated") {
    return fileChangePlan(params.itemId, params.turnId, params.changes, "inProgress");
  }
  if (method === "item/fileChange/outputDelta") {
    return actionPlan({
      type: "display/items-replaced",
      items: appendItemOutput(state.displayItems, params.itemId, params.turnId, params.delta, "fileChange", "File change inProgress"),
    });
  }
  if (method === "turn/diff/updated") {
    return actionPlan({ type: "display/turn-diff-updated", turnId: params.turnId, diff: params.diff });
  }
  if (method === "hook/started") {
    return hookRunPlan(state, params.run, params.turnId, "running");
  }
  if (method === "hook/completed") {
    return hookRunPlan(state, params.run, params.turnId, params.run.status);
  }
  if (method === "item/mcpToolCall/progress") {
    return actionPlan({
      type: "display/items-replaced",
      items: appendToolOutput(state.displayItems, params.itemId, params.turnId, params.message, "mcp progress"),
    });
  }
  if (method === "item/autoApprovalReview/started" || method === "item/autoApprovalReview/completed") {
    const reviewItem = createAutoReviewResultItem(params);
    return actionPlan({
      type: "display/items-replaced",
      items: upsertDisplayItem(removeUnstructuredAutoReviewWarnings(state.displayItems), reviewItem),
    });
  }
  if (method === "guardianWarning") {
    const item = createReviewResultItem(localItemId("review"), params.message);
    if (isUnstructuredAutoReviewWarning(item) && hasStructuredAutoReviewResult(state.displayItems, activeTurnId(state))) {
      return EMPTY_PLAN;
    }
    return actionPlan({ type: "display/item-upserted", item });
  }
  return EMPTY_PLAN;
}

function planTurnLifecycle(state: ChatState, notification: ServerNotification): ChatNotificationPlan {
  const { method, params } = notification;
  if (method === "turn/started") {
    return actionPlan({
      type: "turn/started",
      threadId: params.threadId,
      turnId: params.turn.id,
      displayItems: displayItemsWithPendingPromptSubmitHooks(state, params.turn.id),
    });
  }
  if (method === "turn/completed") {
    if (activeTurnId(state) !== params.turn.id) return EMPTY_PLAN;
    return {
      actions: [
        {
          type: "turn/completed",
          turnId: params.turn.id,
          status: params.turn.status,
          displayItems: completeReasoningItems(reconciledCompletedTurnItems(state, params.turn), params.turn.id),
        },
      ],
      effects: [{ type: "maybe-name-thread", threadId: params.threadId, turn: params.turn }, { type: "refresh-threads" }],
    };
  }
  return EMPTY_PLAN;
}

function planThreadLifecycle(state: ChatState, notification: ServerNotification, localItemId: LocalItemIdFactory): ChatNotificationPlan {
  const { method, params } = notification;
  if (method === "thread/started") {
    if (!state.activeThreadId || state.activeThreadId === params.thread.id) {
      return actionPlan({ type: "thread/cwd-set", cwd: params.thread.cwd });
    }
    return EMPTY_PLAN;
  }
  if (method === "thread/archived") {
    return {
      actions: [
        { type: "thread/list-applied", threads: state.listedThreads.filter((thread) => thread.id !== params.threadId) },
        ...(state.activeThreadId === params.threadId ? ([{ type: "thread/active-cleared" }] satisfies ChatAction[]) : []),
      ],
      effects: [{ type: "notify-thread-archived", threadId: params.threadId }],
    };
  }
  if (method === "thread/unarchived") {
    return { actions: [], effects: [{ type: "refresh-threads" }] };
  }
  if (method === "thread/name/updated") {
    const name = typeof params.threadName === "string" && params.threadName.trim() ? params.threadName.trim() : null;
    return {
      actions: [
        {
          type: "thread/list-applied",
          threads: state.listedThreads.map((thread) => (thread.id === params.threadId ? { ...thread, name } : thread)),
        },
      ],
      effects: [{ type: "notify-thread-renamed", threadId: params.threadId, name }],
    };
  }
  if (method === "thread/settings/updated") {
    if (state.activeThreadId !== params.threadId) return EMPTY_PLAN;
    return actionPlan({
      type: "thread/settings-applied",
      cwd: params.threadSettings.cwd,
      model: params.threadSettings.model,
      reasoningEffort: params.threadSettings.effort,
      collaborationMode: params.threadSettings.collaborationMode.mode,
      serviceTier: parseServiceTier(params.threadSettings.serviceTier),
      approvalPolicy: params.threadSettings.approvalPolicy,
      approvalsReviewer: params.threadSettings.approvalsReviewer,
      activePermissionProfile: params.threadSettings.activePermissionProfile,
    });
  }
  if (method === "thread/goal/updated") {
    if (state.activeThreadId !== params.threadId) return EMPTY_PLAN;
    const actions: ChatAction[] = [{ type: "thread/goal-set", goal: params.goal }];
    const item = goalChangeItem(localItemId("goal"), state.activeGoal, params.goal);
    if (item) {
      actions.push({ type: "display/item-upserted", item });
    }
    return { actions, effects: [] };
  }
  if (method === "thread/goal/cleared") {
    if (state.activeThreadId !== params.threadId) return EMPTY_PLAN;
    const actions: ChatAction[] = [{ type: "thread/goal-set", goal: null }];
    const item = goalChangeItem(localItemId("goal"), state.activeGoal, null);
    if (item) {
      actions.push({ type: "display/item-upserted", item });
    }
    return { actions, effects: [] };
  }
  return EMPTY_PLAN;
}

function planDiagnosticStatus(notification: ServerNotification): ChatNotificationPlan {
  const { method, params } = notification;
  if (method === "thread/tokenUsage/updated") {
    return actionPlan({ type: "thread/token-usage-set", tokenUsage: params.tokenUsage });
  }
  if (method === "account/rateLimits/updated") {
    return {
      actions: [],
      effects: [{ type: "refresh-rate-limits" }],
    };
  }
  if (method === "skills/changed") {
    return { actions: [], effects: [{ type: "refresh-skills", forceReload: true }] };
  }
  if (method === "mcpServer/startupStatus/updated") {
    return {
      actions: [],
      effects:
        params.name.length === 0
          ? [{ type: "publish-app-server-metadata" }]
          : [
              { type: "record-mcp-startup-status", name: params.name, status: params.status, message: params.error },
              { type: "publish-app-server-metadata" },
            ],
    };
  }
  return EMPTY_PLAN;
}

function planUserVisibleNotice(notification: ServerNotification, localItemId: LocalItemIdFactory): ChatNotificationPlan {
  const { method, params } = notification;
  if (method === "thread/compacted") {
    return systemMessagePlan({ id: localItemId("system"), text: "Context compacted." });
  }
  if (method === "model/rerouted" || method === "deprecationNotice") {
    return systemMessagePlan({ id: localItemId("system"), text: `${method}: ${jsonPreview(params)}` });
  }
  if (method === "error" || method === "warning" || method === "configWarning") {
    return systemMessagePlan({ id: localItemId("system"), text: `${method}: ${jsonPreview(params)}` });
  }
  return EMPTY_PLAN;
}

function startedItemPlan(item: ThreadItem, turnId: string): ChatNotificationPlan {
  if (shouldSuppressLifecycleItem(item)) return EMPTY_PLAN;
  const displayItem = displayItemFromThreadItem(item, turnId);
  return displayItem ? actionPlan({ type: "display/item-upserted", item: displayItem }) : EMPTY_PLAN;
}

function completedItemPlan(state: ChatState, item: ThreadItem, turnId: string): ChatNotificationPlan {
  if (item.type === "userMessage") return EMPTY_PLAN;
  const displayItem = displayItemFromThreadItem(item, turnId);
  if (!displayItem) return EMPTY_PLAN;
  let displayItems = upsertDisplayItem(state.displayItems, displayItem);
  if (displayItem.kind === "reasoning") {
    displayItems = completeReasoningItems(displayItems, turnId);
  }
  return actionPlan({ type: "display/items-replaced", items: displayItems });
}

function fileChangePlan(itemId: string, turnId: string, changes: FileUpdateChange[], status: string): ChatNotificationPlan {
  return actionPlan({
    type: "display/item-upserted",
    item: {
      id: itemId,
      kind: "fileChange",
      role: "tool",
      text: `File change ${status}`,
      turnId,
      itemId,
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
  return actionPlan({ type: "display/items-replaced", items: appendItemText(state.displayItems, itemId, turnId, label, delta, kind) });
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
    type: "display/pending-turn-item-upserted",
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
  if (!pending) return state.displayItems;
  return attachHookRunsToTurn(state.displayItems, turnId, pending.promptSubmitHookItemIds, pending.anchorItemId);
}

function reconciledCompletedTurnItems(state: ChatState, turn: Turn): readonly DisplayItem[] {
  const turnItems = displayItemsFromTurns([turn]);
  if (turnItems.length === 0) return state.displayItems;
  const serverUserMessages = turnItems.filter(isUserMessage);
  const serverUserClientIds = new Set(serverUserMessages.map((item) => item.clientId).filter(isString));
  const serverUserMessagesByClientId = new Map(
    serverUserMessages.flatMap((item) => (item.clientId ? ([[item.clientId, item]] as const) : [])),
  );
  const serverUserFallbackTexts = serverUserClientIds.size > 0 ? new Set<string>() : new Set(serverUserMessages.map((item) => item.text));
  const stateDisplayItems = state.displayItems.map(
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
  return actionPlan({ type: "system/message-added", item: createSystemItem(message.id, message.text) });
}

function actionPlan(action: ChatAction): ChatNotificationPlan {
  return { actions: [action], effects: [] };
}
