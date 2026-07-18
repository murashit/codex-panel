import { reconcileCompletedTurnItems } from "../../domain/thread-stream/completed-turn-reconciliation";
import type { ThreadStreamItem } from "../../domain/thread-stream/items";
import { attachHookRunsToTurn, completeReasoningItems, upsertThreadStreamItemById } from "../../domain/thread-stream/updates";
import { type ChatAction, type ChatState, chatReducer } from "../state/root-reducer";
import { threadStreamItems } from "../state/thread-stream";
import type { TurnRuntimeEvent } from "./runtime-events";
import { activeTurnId, pendingTurnStart as pendingTurnStartForState } from "./turn-state";

export interface TurnRuntimeOutcome {
  type: "turn-completed";
  threadId: string;
  turnId: string;
  completedTurnTranscriptSummary: TurnRuntimeEventCompletedTurnTranscriptSummary;
}

type TurnRuntimeEventCompletedTurnTranscriptSummary = Extract<
  TurnRuntimeEvent,
  { type: "turnCompleted" }
>["completedTurnTranscriptSummary"];

export interface TurnRuntimePlan {
  actions: readonly ChatAction[];
  outcomes: readonly TurnRuntimeOutcome[];
}

const EMPTY_PLAN: TurnRuntimePlan = { actions: [], outcomes: [] };

export function planTurnRuntimeEvents(state: ChatState, events: readonly TurnRuntimeEvent[]): TurnRuntimePlan {
  let currentState = state;
  const actions: ChatAction[] = [];
  const outcomes: TurnRuntimeOutcome[] = [];
  for (const event of events) {
    const plan = planTurnRuntimeEvent(currentState, event);
    actions.push(...plan.actions);
    outcomes.push(...plan.outcomes);
    currentState = reducePlannedActions(currentState, plan.actions);
  }
  return actions.length === 0 && outcomes.length === 0 ? EMPTY_PLAN : { actions, outcomes };
}

function planTurnRuntimeEvent(state: ChatState, event: TurnRuntimeEvent): TurnRuntimePlan {
  switch (event.type) {
    case "assistantDelta":
      return actionPlan({
        type: "thread-stream/assistant-delta-appended",
        itemId: event.itemId,
        turnId: event.turnId,
        delta: event.delta,
        completeReasoning: event.completeReasoning,
      });
    case "planDelta":
      return actionPlan({
        type: "thread-stream/plan-delta-appended",
        itemId: event.itemId,
        turnId: event.turnId,
        delta: event.delta,
      });
    case "textDelta":
      return actionPlan({
        type: "thread-stream/item-text-appended",
        itemId: event.itemId,
        turnId: event.turnId,
        label: event.label,
        delta: event.delta,
        kind: event.kind,
      });
    case "toolOutputDelta":
      return actionPlan({
        type: "thread-stream/tool-output-appended",
        itemId: event.itemId,
        turnId: event.turnId,
        delta: event.delta,
        fallbackLabel: event.fallbackLabel,
      });
    case "itemOutputDelta":
      return actionPlan({
        type: "thread-stream/item-output-appended",
        itemId: event.itemId,
        turnId: event.turnId,
        delta: event.delta,
        kind: event.kind,
        fallbackText: event.fallbackText,
      });
    case "itemUpserted":
      return actionPlan({ type: "thread-stream/item-upserted", item: event.item });
    case "itemCompleted":
      return completedItemPlan(event.item, event.turnId);
    case "autoReviewUpdated":
      return autoReviewUpdatedPlan(state, event.item);
    case "turnStarted":
      return turnStartedPlan(state, event);
    case "turnCompleted":
      return turnCompletedPlan(state, event);
    case "turnDiffUpdated":
      return actionPlan({ type: "thread-stream/turn-diff-updated", turnId: event.turnId, diff: event.diff });
    case "hookRunObserved":
      return hookRunPlan(state, event);
    case "requestResolved":
      return actionPlan({ type: "request/resolved", requestId: event.requestId });
    case "reviewWarning":
      return reviewWarningPlan(state, event.item);
    case "systemNotice":
      return actionPlan({ type: "thread-stream/system-item-added", item: event.item });
  }
}

function turnStartedPlan(state: ChatState, event: Extract<TurnRuntimeEvent, { type: "turnStarted" }>): TurnRuntimePlan {
  return {
    actions: [
      {
        type: "turn/started",
        threadId: event.threadId,
        turnId: event.turnId,
        items: threadStreamItemsWithPendingPromptSubmitHooks(state, event.turnId),
      },
    ],
    outcomes: [],
  };
}

function turnCompletedPlan(state: ChatState, event: Extract<TurnRuntimeEvent, { type: "turnCompleted" }>): TurnRuntimePlan {
  if (activeTurnId(state) !== event.turnId) return EMPTY_PLAN;
  return {
    actions: [
      {
        type: "turn/completed",
        turnId: event.turnId,
        status: event.status,
        items: completeReasoningItems(
          reconcileCompletedTurnItems({
            currentItems: threadStreamItems(state.threadStream),
            completedTurnId: event.turnId,
            turnItems: event.completedItems,
          }),
          event.turnId,
        ),
      },
    ],
    outcomes: [
      {
        type: "turn-completed",
        threadId: event.threadId,
        turnId: event.turnId,
        completedTurnTranscriptSummary: event.completedTurnTranscriptSummary,
      },
    ],
  };
}

function completedItemPlan(item: ThreadStreamItem, turnId: string): TurnRuntimePlan {
  return {
    actions: [
      { type: "thread-stream/item-upserted", item },
      ...(item.kind === "reasoning" ? ([{ type: "thread-stream/reasoning-completed", turnId: turnId }] satisfies ChatAction[]) : []),
    ],
    outcomes: [],
  };
}

function hookRunPlan(state: ChatState, event: Extract<TurnRuntimeEvent, { type: "hookRunObserved" }>): TurnRuntimePlan {
  const resolvedTurnId = hookTurnId(state, event);
  const item = resolvedTurnId ? { ...event.item, turnId: resolvedTurnId } : event.item;
  const currentPendingTurnStart = pendingTurnStartForState(state);
  let pendingTurnStart = currentPendingTurnStart;
  if (!resolvedTurnId && currentPendingTurnStart && event.eventName === "userPromptSubmit") {
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

function hookTurnId(state: ChatState, event: Extract<TurnRuntimeEvent, { type: "hookRunObserved" }>): string | null {
  if (event.turnId) return event.turnId;
  if (event.eventName === "userPromptSubmit" && !pendingTurnStartForState(state)) return activeTurnId(state);
  return null;
}

function reviewWarningPlan(state: ChatState, item: ThreadStreamItem): TurnRuntimePlan {
  if (isUnstructuredAutoReviewWarning(item) && hasStructuredAutoReviewResult(threadStreamItems(state.threadStream), activeTurnId(state))) {
    return EMPTY_PLAN;
  }
  return actionPlan({ type: "thread-stream/item-upserted", item });
}

function autoReviewUpdatedPlan(state: ChatState, item: ThreadStreamItem): TurnRuntimePlan {
  return actionPlan({
    type: "thread-stream/items-replaced",
    items: upsertThreadStreamItemById(
      threadStreamItems(state.threadStream).filter((currentItem) => !isUnstructuredAutoReviewWarning(currentItem)),
      item,
    ),
  });
}

function threadStreamItemsWithPendingPromptSubmitHooks(state: ChatState, turnId: string): readonly ThreadStreamItem[] {
  const pending = pendingTurnStartForState(state);
  const items = threadStreamItems(state.threadStream);
  if (!pending) return items;
  return attachHookRunsToTurn(items, turnId, pending.promptSubmitHookItemIds, pending.anchorItemId);
}

function hasStructuredAutoReviewResult(items: readonly ThreadStreamItem[], activeTurnId: string | null): boolean {
  return items.some(
    (item) =>
      item.kind === "reviewResult" &&
      Boolean(item.turnId) &&
      (!activeTurnId || item.turnId === activeTurnId) &&
      isAutoReviewText(item.text),
  );
}

function isUnstructuredAutoReviewWarning(item: ThreadStreamItem): boolean {
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

function actionPlan(action: ChatAction): TurnRuntimePlan {
  return { actions: [action], outcomes: [] };
}
