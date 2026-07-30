import { reconcileCompletedTurnItems } from "../../domain/thread-stream/completed-turn-reconciliation";
import type { ThreadStreamItem } from "../../domain/thread-stream/items";
import { attachHookRunsToTurn, completeReasoningItems, upsertThreadStreamItemById } from "../../domain/thread-stream/updates";
import { type ChatAction, type ChatState, chatReducer } from "../state/root-reducer";
import { threadStreamItems, threadStreamPendingSteers } from "../state/thread-stream";
import type { TurnRuntimeFact } from "./runtime-facts";
import { activeTurnId, pendingTurnStart as pendingTurnStartForState } from "./turn-state";

export interface TurnRuntimeProjectionOutcome {
  type: "turn-completed";
  threadId: string;
  turnId: string;
  completedTurnTranscriptSummary: TurnRuntimeFactCompletedTurnTranscriptSummary;
}

type TurnRuntimeFactCompletedTurnTranscriptSummary = Extract<TurnRuntimeFact, { type: "turnCompleted" }>["completedTurnTranscriptSummary"];

export interface TurnRuntimeProjection {
  actions: readonly ChatAction[];
  outcomes: readonly TurnRuntimeProjectionOutcome[];
}

const EMPTY_PROJECTION: TurnRuntimeProjection = { actions: [], outcomes: [] };

export function projectTurnRuntimeFacts(state: ChatState, facts: readonly TurnRuntimeFact[]): TurnRuntimeProjection {
  let currentState = state;
  const actions: ChatAction[] = [];
  const outcomes: TurnRuntimeProjectionOutcome[] = [];
  for (const fact of facts) {
    const projection = projectTurnRuntimeFact(currentState, fact);
    actions.push(...projection.actions);
    outcomes.push(...projection.outcomes);
    currentState = reduceProjectedActions(currentState, projection.actions);
  }
  return actions.length === 0 && outcomes.length === 0 ? EMPTY_PROJECTION : { actions, outcomes };
}

function projectTurnRuntimeFact(state: ChatState, fact: TurnRuntimeFact): TurnRuntimeProjection {
  switch (fact.type) {
    case "assistantDelta":
      return actionProjection({
        type: "thread-stream/assistant-delta-appended",
        itemId: fact.itemId,
        turnId: fact.turnId,
        delta: fact.delta,
        completeReasoning: fact.completeReasoning,
      });
    case "planDelta":
      return actionProjection({
        type: "thread-stream/plan-delta-appended",
        itemId: fact.itemId,
        turnId: fact.turnId,
        delta: fact.delta,
      });
    case "textDelta":
      return actionProjection({
        type: "thread-stream/item-text-appended",
        itemId: fact.itemId,
        turnId: fact.turnId,
        label: fact.label,
        delta: fact.delta,
        kind: fact.kind,
      });
    case "toolOutputDelta":
      return actionProjection({
        type: "thread-stream/tool-output-appended",
        itemId: fact.itemId,
        turnId: fact.turnId,
        delta: fact.delta,
        fallbackLabel: fact.fallbackLabel,
      });
    case "itemOutputDelta":
      return actionProjection({
        type: "thread-stream/item-output-appended",
        itemId: fact.itemId,
        turnId: fact.turnId,
        delta: fact.delta,
        kind: fact.kind,
        fallbackText: fact.fallbackText,
      });
    case "itemUpserted":
      return actionProjection({ type: "thread-stream/item-upserted", item: fact.item });
    case "userMessageObserved":
      return fact.item.clientId && threadStreamPendingSteers(state.threadStream).some((pending) => pending.clientId === fact.item.clientId)
        ? actionProjection({ type: "thread-stream/pending-steer-committed", item: fact.item })
        : EMPTY_PROJECTION;
    case "itemCompleted":
      return completedItemProjection(fact.item, fact.turnId);
    case "autoReviewUpdated":
      return autoReviewUpdatedProjection(state, fact.item);
    case "turnStarted":
      return turnStartedProjection(state, fact);
    case "turnCompleted":
      return turnCompletedProjection(state, fact);
    case "turnDiffUpdated":
      return actionProjection({ type: "thread-stream/turn-diff-updated", turnId: fact.turnId, diff: fact.diff });
    case "hookRunObserved":
      return hookRunProjection(state, fact);
    case "requestResolved":
      return actionProjection({ type: "request/resolved", requestId: fact.requestId });
    case "reviewWarning":
      return reviewWarningProjection(state, fact.item);
    case "systemNotice":
      return actionProjection({ type: "thread-stream/system-item-added", item: fact.item });
  }
}

function turnStartedProjection(state: ChatState, fact: Extract<TurnRuntimeFact, { type: "turnStarted" }>): TurnRuntimeProjection {
  return {
    actions: [
      {
        type: "turn/started",
        threadId: fact.threadId,
        turnId: fact.turnId,
        items: threadStreamItemsWithPendingPromptSubmitHooks(state, fact.turnId),
      },
    ],
    outcomes: [],
  };
}

function turnCompletedProjection(state: ChatState, fact: Extract<TurnRuntimeFact, { type: "turnCompleted" }>): TurnRuntimeProjection {
  if (activeTurnId(state) !== fact.turnId) return EMPTY_PROJECTION;
  const reconciledItems = reconcileCompletedTurnItems({
    currentItems: threadStreamItems(state.threadStream),
    completedTurnId: fact.turnId,
    turnItems: fact.itemsView === "notLoaded" ? [] : fact.completedItems,
  });
  return {
    actions: [
      {
        type: "turn/completed",
        turnId: fact.turnId,
        status: fact.status,
        items: completeReasoningItems(reconciledItems, fact.turnId),
      },
    ],
    outcomes: [
      {
        type: "turn-completed",
        threadId: fact.threadId,
        turnId: fact.turnId,
        completedTurnTranscriptSummary: fact.completedTurnTranscriptSummary,
      },
    ],
  };
}

function completedItemProjection(item: ThreadStreamItem, turnId: string): TurnRuntimeProjection {
  return {
    actions: [
      { type: "thread-stream/item-upserted", item },
      ...(item.kind === "reasoning" ? ([{ type: "thread-stream/reasoning-completed", turnId: turnId }] satisfies ChatAction[]) : []),
    ],
    outcomes: [],
  };
}

function hookRunProjection(state: ChatState, fact: Extract<TurnRuntimeFact, { type: "hookRunObserved" }>): TurnRuntimeProjection {
  const resolvedTurnId = hookTurnId(state, fact);
  const item = resolvedTurnId ? { ...fact.item, turnId: resolvedTurnId } : fact.item;
  const currentPendingTurnStart = pendingTurnStartForState(state);
  let pendingTurnStart = currentPendingTurnStart;
  if (!resolvedTurnId && currentPendingTurnStart && fact.eventName === "userPromptSubmit") {
    const hookIds = currentPendingTurnStart.promptSubmitHookItemIds;
    pendingTurnStart = hookIds.includes(item.id)
      ? currentPendingTurnStart
      : { ...currentPendingTurnStart, promptSubmitHookItemIds: [...hookIds, item.id] };
  }
  return actionProjection({
    type: "turn/pending-start-hook-upserted",
    item,
    pendingTurnStart,
  });
}

function hookTurnId(state: ChatState, fact: Extract<TurnRuntimeFact, { type: "hookRunObserved" }>): string | null {
  if (fact.turnId) return fact.turnId;
  if (fact.eventName === "userPromptSubmit" && !pendingTurnStartForState(state)) return activeTurnId(state);
  return null;
}

function reviewWarningProjection(state: ChatState, item: ThreadStreamItem): TurnRuntimeProjection {
  if (isUnstructuredAutoReviewWarning(item) && hasStructuredAutoReviewResult(threadStreamItems(state.threadStream), activeTurnId(state))) {
    return EMPTY_PROJECTION;
  }
  return actionProjection({ type: "thread-stream/item-upserted", item });
}

function autoReviewUpdatedProjection(state: ChatState, item: ThreadStreamItem): TurnRuntimeProjection {
  return actionProjection({
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

function reduceProjectedActions(state: ChatState, actions: readonly ChatAction[]): ChatState {
  return actions.reduce(reduceProjectedAction, state);
}

function reduceProjectedAction(state: ChatState, action: ChatAction): ChatState {
  return chatReducer(state, action);
}

function actionProjection(action: ChatAction): TurnRuntimeProjection {
  return { actions: [action], outcomes: [] };
}
