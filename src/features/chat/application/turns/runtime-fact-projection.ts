import { reconcileCompletedTurnItems } from "../../domain/thread-stream/completed-turn-reconciliation";
import type { ThreadStreamItem } from "../../domain/thread-stream/items";
import { completeReasoningItems, upsertThreadStreamItemById } from "../../domain/thread-stream/updates";
import type { ChatState } from "../state/model";
import type { ChatAction } from "../state/reducer";
import { threadStreamItems, threadStreamPendingSteers } from "../state/thread-stream";
import { chatThreadStreamViewState } from "../state/turn-scope";
import type { TurnRuntimeFact } from "./runtime-facts";
import { activeTurnId } from "./turn-state";

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

export function projectTurnRuntimeFact(state: ChatState, fact: TurnRuntimeFact): TurnRuntimeProjection {
  return withCompletedAuthRecoveryCleared(state, fact, runtimeFactProjection(state, fact));
}

function runtimeFactProjection(state: ChatState, fact: TurnRuntimeFact): TurnRuntimeProjection {
  switch (fact.type) {
    case "authRecoveryUpdated":
      return actionProjection({ type: "auth-recovery/updated", turnId: fact.turnId, progress: fact.progress });
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
    case "itemStarted":
    case "itemContentUpdated":
    case "hookRunObserved":
    case "taskProgressUpdated":
      return actionProjection({ type: "thread-stream/item-upserted", item: fact.item });
    case "userMessageObserved":
      return fact.item.clientId &&
        threadStreamPendingSteers(chatThreadStreamViewState(state.threadStream, state.activeTurn)).some(
          (pending) => pending.clientId === fact.item.clientId,
        )
        ? actionProjection({ type: "thread-stream/pending-steer-committed", item: fact.item })
        : EMPTY_PROJECTION;
    case "itemCompleted":
      return completedItemProjection(fact.item, fact.turnId);
    case "autoReviewUpdated":
      return autoReviewUpdatedProjection(state, fact.item);
    case "turnStarted":
      return turnStartedProjection(fact);
    case "turnCompleted":
      return turnCompletedProjection(state, fact);
    case "turnDiffUpdated":
      return actionProjection({ type: "thread-stream/turn-diff-updated", turnId: fact.turnId, diff: fact.diff });
    case "requestResolved":
      return actionProjection({ type: "request/resolved", requestId: fact.requestId });
    case "reviewWarning":
      return reviewWarningProjection(state, fact.item);
    case "systemNotice":
      return actionProjection({ type: "thread-stream/system-item-added", item: fact.item });
  }
}

function withCompletedAuthRecoveryCleared(
  state: ChatState,
  fact: TurnRuntimeFact,
  projection: TurnRuntimeProjection,
): TurnRuntimeProjection {
  if (state.activeTurn.authRecovery?.phase !== "completed" || !turnRuntimeFactAdvancesActivity(fact)) return projection;
  return {
    actions: [{ type: "auth-recovery/cleared" }, ...projection.actions],
    outcomes: projection.outcomes,
  };
}

function turnRuntimeFactAdvancesActivity(fact: TurnRuntimeFact): boolean {
  switch (fact.type) {
    case "assistantDelta":
    case "planDelta":
    case "textDelta":
    case "toolOutputDelta":
    case "itemOutputDelta":
    case "itemStarted":
    case "itemContentUpdated":
    case "taskProgressUpdated":
    case "userMessageObserved":
    case "itemCompleted":
    case "autoReviewUpdated":
    case "turnDiffUpdated":
    case "hookRunObserved":
    case "reviewWarning":
    case "systemNotice":
      return true;
    case "authRecoveryUpdated":
    case "turnStarted":
    case "turnCompleted":
    case "requestResolved":
      return false;
  }
}

function turnStartedProjection(fact: Extract<TurnRuntimeFact, { type: "turnStarted" }>): TurnRuntimeProjection {
  return {
    actions: [
      {
        type: "turn/started",
        threadId: fact.threadId,
        turnId: fact.turnId,
      },
    ],
    outcomes: [],
  };
}

function turnCompletedProjection(state: ChatState, fact: Extract<TurnRuntimeFact, { type: "turnCompleted" }>): TurnRuntimeProjection {
  if (activeTurnId(state.activeTurn) !== fact.turnId) return EMPTY_PROJECTION;
  const reconciledItems = reconcileCompletedTurnItems({
    currentItems: threadStreamItems(chatThreadStreamViewState(state.threadStream, state.activeTurn)),
    completedTurnId: fact.turnId,
    turnItems: fact.completedItems,
  });
  return {
    actions: [
      {
        type: "turn/completed",
        turnId: fact.turnId,
        outcome: fact.outcome,
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

function reviewWarningProjection(state: ChatState, item: ThreadStreamItem): TurnRuntimeProjection {
  if (
    isUnstructuredAutoReviewWarning(item) &&
    hasStructuredAutoReviewResult(
      threadStreamItems(chatThreadStreamViewState(state.threadStream, state.activeTurn)),
      activeTurnId(state.activeTurn),
    )
  ) {
    return EMPTY_PROJECTION;
  }
  const turnId = activeTurnId(state.activeTurn);
  return actionProjection({ type: "thread-stream/item-upserted", item: turnId ? { ...item, turnId } : item });
}

function autoReviewUpdatedProjection(state: ChatState, item: ThreadStreamItem): TurnRuntimeProjection {
  return actionProjection({
    type: "thread-stream/content-replaced",
    items: upsertThreadStreamItemById(
      threadStreamItems(chatThreadStreamViewState(state.threadStream, state.activeTurn)).filter(
        (currentItem) => !isUnstructuredAutoReviewWarning(currentItem),
      ),
      item,
    ),
  });
}

function hasStructuredAutoReviewResult(items: readonly ThreadStreamItem[], activeTurnId: string | null): boolean {
  return items.some(
    (item) =>
      item.kind === "reviewResult" &&
      Boolean(item.turnId) &&
      (!activeTurnId || item.turnId === activeTurnId) &&
      item.reviewKind === "automaticResult",
  );
}

function isUnstructuredAutoReviewWarning(item: ThreadStreamItem): boolean {
  return item.kind === "reviewResult" && item.reviewKind === "automaticWarning";
}

function actionProjection(action: ChatAction): TurnRuntimeProjection {
  return { actions: [action], outcomes: [] };
}
