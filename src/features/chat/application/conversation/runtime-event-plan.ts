import { reconcileCompletedTurnItems } from "../../domain/message-stream/completed-turn-reconciliation";
import type { MessageStreamItem } from "../../domain/message-stream/items";
import { attachHookRunsToTurn, completeReasoningItems, upsertMessageStreamItemById } from "../../domain/message-stream/updates";
import { messageStreamItems } from "../state/message-stream";
import { type ChatAction, type ChatState, chatReducer } from "../state/root-reducer";
import type { ConversationRuntimeEvent } from "./runtime-events";
import { activeTurnId, pendingTurnStart as pendingTurnStartForState } from "./turn-state";

export type ConversationRuntimeOutcome =
  | { type: "run-started"; threadId: string; runId: string; recencyAt: number | null }
  | { type: "run-completed"; threadId: string; runId: string; completedSummary: ConversationRuntimeEventCompletedSummary };

type ConversationRuntimeEventCompletedSummary = Extract<ConversationRuntimeEvent, { type: "runCompleted" }>["completedSummary"];

export interface ConversationRuntimePlan {
  actions: readonly ChatAction[];
  outcomes: readonly ConversationRuntimeOutcome[];
}

const EMPTY_PLAN: ConversationRuntimePlan = { actions: [], outcomes: [] };

export function planConversationRuntimeEvents(state: ChatState, events: readonly ConversationRuntimeEvent[]): ConversationRuntimePlan {
  let currentState = state;
  const actions: ChatAction[] = [];
  const outcomes: ConversationRuntimeOutcome[] = [];
  for (const event of events) {
    const plan = planConversationRuntimeEvent(currentState, event);
    actions.push(...plan.actions);
    outcomes.push(...plan.outcomes);
    currentState = reducePlannedActions(currentState, plan.actions);
  }
  return actions.length === 0 && outcomes.length === 0 ? EMPTY_PLAN : { actions, outcomes };
}

function planConversationRuntimeEvent(state: ChatState, event: ConversationRuntimeEvent): ConversationRuntimePlan {
  switch (event.type) {
    case "assistantDelta":
      return actionPlan({
        type: "message-stream/assistant-delta-appended",
        itemId: event.itemId,
        turnId: event.runId,
        delta: event.delta,
        completeReasoning: event.completeReasoning,
      });
    case "planDelta":
      return actionPlan({
        type: "message-stream/plan-delta-appended",
        itemId: event.itemId,
        turnId: event.runId,
        delta: event.delta,
      });
    case "textDelta":
      return actionPlan({
        type: "message-stream/item-text-appended",
        itemId: event.itemId,
        turnId: event.runId,
        label: event.label,
        delta: event.delta,
        kind: event.kind,
      });
    case "toolOutputDelta":
      return actionPlan({
        type: "message-stream/tool-output-appended",
        itemId: event.itemId,
        turnId: event.runId,
        delta: event.delta,
        fallbackLabel: event.fallbackLabel,
      });
    case "itemOutputDelta":
      return actionPlan({
        type: "message-stream/item-output-appended",
        itemId: event.itemId,
        turnId: event.runId,
        delta: event.delta,
        kind: event.kind,
        fallbackText: event.fallbackText,
      });
    case "itemUpserted":
      return actionPlan({ type: "message-stream/item-upserted", item: event.item });
    case "itemCompleted":
      return completedItemPlan(event.item, event.runId);
    case "autoReviewUpdated":
      return autoReviewUpdatedPlan(state, event.item);
    case "runStarted":
      return runStartedPlan(state, event);
    case "runCompleted":
      return runCompletedPlan(state, event);
    case "turnDiffUpdated":
      return actionPlan({ type: "message-stream/turn-diff-updated", turnId: event.runId, diff: event.diff });
    case "hookRunObserved":
      return hookRunPlan(state, event);
    case "requestResolved":
      return actionPlan({ type: "request/resolved", requestId: event.requestId });
    case "reviewWarning":
      return reviewWarningPlan(state, event.item);
    case "systemNotice":
      return actionPlan({ type: "message-stream/system-item-added", item: event.item });
  }
}

function runStartedPlan(state: ChatState, event: Extract<ConversationRuntimeEvent, { type: "runStarted" }>): ConversationRuntimePlan {
  return {
    actions: [
      {
        type: "turn/started",
        threadId: event.threadId,
        turnId: event.runId,
        items: messageStreamItemsWithPendingPromptSubmitHooks(state, event.runId),
      },
    ],
    outcomes: [
      {
        type: "run-started",
        threadId: event.threadId,
        runId: event.runId,
        recencyAt: event.recencyAt,
      },
    ],
  };
}

function runCompletedPlan(state: ChatState, event: Extract<ConversationRuntimeEvent, { type: "runCompleted" }>): ConversationRuntimePlan {
  if (activeTurnId(state) !== event.runId) return EMPTY_PLAN;
  return {
    actions: [
      {
        type: "turn/completed",
        turnId: event.runId,
        status: event.status,
        items: completeReasoningItems(
          reconcileCompletedTurnItems({
            currentItems: messageStreamItems(state.messageStream),
            completedTurnId: event.runId,
            turnItems: event.completedItems,
          }),
          event.runId,
        ),
      },
    ],
    outcomes: [
      {
        type: "run-completed",
        threadId: event.threadId,
        runId: event.runId,
        completedSummary: event.completedSummary,
      },
    ],
  };
}

function completedItemPlan(item: MessageStreamItem, runId: string): ConversationRuntimePlan {
  return {
    actions: [
      { type: "message-stream/item-upserted", item },
      ...(item.kind === "reasoning" ? ([{ type: "message-stream/reasoning-completed", turnId: runId }] satisfies ChatAction[]) : []),
    ],
    outcomes: [],
  };
}

function hookRunPlan(state: ChatState, event: Extract<ConversationRuntimeEvent, { type: "hookRunObserved" }>): ConversationRuntimePlan {
  const resolvedRunId = hookRunId(state, event);
  const item = resolvedRunId ? { ...event.item, turnId: resolvedRunId } : event.item;
  const currentPendingTurnStart = pendingTurnStartForState(state);
  let pendingTurnStart = currentPendingTurnStart;
  if (!resolvedRunId && currentPendingTurnStart && event.eventName === "userPromptSubmit") {
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

function hookRunId(state: ChatState, event: Extract<ConversationRuntimeEvent, { type: "hookRunObserved" }>): string | null {
  if (event.runId) return event.runId;
  if (event.eventName === "userPromptSubmit" && !pendingTurnStartForState(state)) return activeTurnId(state);
  return null;
}

function reviewWarningPlan(state: ChatState, item: MessageStreamItem): ConversationRuntimePlan {
  if (
    isUnstructuredAutoReviewWarning(item) &&
    hasStructuredAutoReviewResult(messageStreamItems(state.messageStream), activeTurnId(state))
  ) {
    return EMPTY_PLAN;
  }
  return actionPlan({ type: "message-stream/item-upserted", item });
}

function autoReviewUpdatedPlan(state: ChatState, item: MessageStreamItem): ConversationRuntimePlan {
  return actionPlan({
    type: "message-stream/items-replaced",
    items: upsertMessageStreamItemById(
      messageStreamItems(state.messageStream).filter((currentItem) => !isUnstructuredAutoReviewWarning(currentItem)),
      item,
    ),
  });
}

function messageStreamItemsWithPendingPromptSubmitHooks(state: ChatState, runId: string): readonly MessageStreamItem[] {
  const pending = pendingTurnStartForState(state);
  const items = messageStreamItems(state.messageStream);
  if (!pending) return items;
  return attachHookRunsToTurn(items, runId, pending.promptSubmitHookItemIds, pending.anchorItemId);
}

function hasStructuredAutoReviewResult(items: readonly MessageStreamItem[], activeRunId: string | null): boolean {
  return items.some(
    (item) =>
      item.kind === "reviewResult" && Boolean(item.turnId) && (!activeRunId || item.turnId === activeRunId) && isAutoReviewText(item.text),
  );
}

function isUnstructuredAutoReviewWarning(item: MessageStreamItem): boolean {
  return item.kind === "reviewResult" && !item.turnId && isAutoReviewText(item.text);
}

function isAutoReviewText(text: string): boolean {
  return /^Auto-review\b/i.test(text.trim());
}

function reducePlannedActions(state: ChatState, actions: readonly ChatAction[]): ChatState {
  return actions.reduce(reducePlannedAction, state);
}

function reducePlannedAction(state: ChatState, action: ChatAction): ChatState {
  return chatReducer(state, action);
}

function actionPlan(action: ChatAction): ConversationRuntimePlan {
  return { actions: [action], outcomes: [] };
}
