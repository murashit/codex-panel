import type { ThreadStreamItem } from "../../domain/thread-stream/items";
import type { ChatTurnLifecycleState } from "../turns/turn-state";
import {
  type ChatSubagentActivityState,
  initialSubagentActivityState,
  isSubagentActivityAction,
  reduceSubagentActivitySlice,
  type SubagentActivityAction,
} from "./subagent-activity";
import {
  type ChatThreadStreamActiveState,
  type ChatThreadStreamState,
  type ChatThreadStreamViewState,
  isThreadStreamAction,
  reduceThreadStreamSlice,
  type ThreadStreamAction,
  threadStreamStartActiveSegment,
  threadStreamWithActiveTurnItems,
} from "./thread-stream";

export interface ChatActiveTurnState extends ChatThreadStreamActiveState {
  readonly lifecycle: ChatTurnLifecycleState;
  readonly turnScopeRevision: number;
  readonly subagents: ChatSubagentActivityState;
}

export type TurnScopeAction = ThreadStreamAction | SubagentActivityAction;

export interface TurnScopeResult {
  readonly activeTurn: ChatActiveTurnState;
  readonly threadStream: ChatThreadStreamState;
}

export function initialChatActiveTurnState(turnScopeRevision = 0): ChatActiveTurnState {
  const lifecycle: ChatTurnLifecycleState = { kind: "idle" };
  return {
    lifecycle,
    turnScopeRevision,
    activeSegment: null,
    pendingSteers: [],
    subagents: initialSubagentActivityState(),
  };
}

export function chatThreadStreamViewState(
  threadStream: ChatThreadStreamState,
  activeTurn: Pick<ChatActiveTurnState, "activeSegment" | "pendingSteers">,
): ChatThreadStreamViewState {
  return {
    ...threadStream,
    activeSegment: activeTurn.activeSegment,
    pendingSteers: activeTurn.pendingSteers,
  };
}

export function activeTurnWithLifecycle(state: ChatActiveTurnState, lifecycle: ChatTurnLifecycleState): ChatActiveTurnState {
  if (lifecycle === state.lifecycle) return state;
  const scopeChanged = !sameTurnScope(state.lifecycle, lifecycle);
  const transientReset =
    lifecycle.kind === "idle" && state.lifecycle.kind !== "idle"
      ? { activeSegment: null, pendingSteers: [], subagents: initialSubagentActivityState() }
      : scopeChanged
        ? { subagents: initialSubagentActivityState() }
        : {};
  return {
    ...state,
    ...transientReset,
    lifecycle,
    turnScopeRevision: scopeChanged ? state.turnScopeRevision + 1 : state.turnScopeRevision,
  };
}

function sameTurnScope(left: ChatTurnLifecycleState, right: ChatTurnLifecycleState): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "starting" && right.kind === "starting") {
    return left.pendingTurnStart.anchorItemId === right.pendingTurnStart.anchorItemId;
  }
  if (left.kind === "running" && right.kind === "running") return left.turnId === right.turnId;
  return true;
}

export function activeTurnCleared(state: ChatActiveTurnState): ChatActiveTurnState {
  return initialChatActiveTurnState(state.turnScopeRevision + 1);
}

export function activeTurnStartedWithItems(
  state: ChatActiveTurnState,
  threadStream: ChatThreadStreamState,
  turnId: string,
  items: readonly ThreadStreamItem[],
): TurnScopeResult {
  const view = chatThreadStreamViewState(threadStream, state);
  const nextView = threadStreamWithActiveTurnItems(view, turnId, items);
  return splitViewState(state, nextView);
}

export function activeTurnStartedWithoutItems(
  state: ChatActiveTurnState,
  threadStream: ChatThreadStreamState,
  turnId: string,
): TurnScopeResult {
  const view = chatThreadStreamViewState(threadStream, state);
  return splitViewState(state, threadStreamStartActiveSegment(view, turnId, []));
}

export function activeTurnOptimisticallyStarted(
  state: ChatActiveTurnState,
  threadStream: ChatThreadStreamState,
  item: ThreadStreamItem,
): TurnScopeResult {
  const view = chatThreadStreamViewState(threadStream, state);
  return splitViewState(state, threadStreamStartActiveSegment(view, null, [item]));
}

export function isTurnScopeAction(action: { type: string }): action is TurnScopeAction {
  return isThreadStreamAction(action) || isSubagentActivityAction(action);
}

export function reduceTurnScope(
  activeTurn: ChatActiveTurnState,
  threadStream: ChatThreadStreamState,
  action: TurnScopeAction,
): TurnScopeResult {
  if (isSubagentActivityAction(action)) return reduceSubagentAction(activeTurn, threadStream, action);
  if (staleThreadStreamAction(activeTurn, action)) {
    return { activeTurn, threadStream };
  }

  const nextView = reduceThreadStreamSlice(chatThreadStreamViewState(threadStream, activeTurn), action);
  return splitViewState(activeTurn, nextView);
}

function reduceSubagentAction(
  activeTurn: ChatActiveTurnState,
  threadStream: ChatThreadStreamState,
  action: SubagentActivityAction,
): TurnScopeResult {
  const parentTurnId = activeTurn.lifecycle.kind === "running" ? activeTurn.lifecycle.turnId : null;
  if (
    !parentTurnId ||
    ((action.type === "subagent-activity/tracked" || action.type === "subagent-activity/coordination-observed") &&
      action.parentTurnId !== parentTurnId)
  ) {
    return { activeTurn, threadStream };
  }
  const subagents = reduceSubagentActivitySlice(activeTurn.subagents, action);
  return subagents === activeTurn.subagents ? { activeTurn, threadStream } : { activeTurn: { ...activeTurn, subagents }, threadStream };
}

function staleThreadStreamAction(activeTurn: ChatActiveTurnState, action: ThreadStreamAction): boolean {
  const activeTurnId = activeTurn.lifecycle.kind === "running" ? activeTurn.lifecycle.turnId : activeTurn.activeSegment?.turnId;
  switch (action.type) {
    case "thread-stream/assistant-delta-appended":
    case "thread-stream/plan-delta-appended":
    case "thread-stream/item-text-appended":
    case "thread-stream/tool-output-appended":
    case "thread-stream/item-output-appended":
    case "thread-stream/reasoning-completed":
      return activeTurn.lifecycle.kind !== "running" ? activeTurnId !== action.turnId : action.turnId !== activeTurnId;
    case "thread-stream/item-added":
    case "thread-stream/system-item-added":
    case "thread-stream/item-upserted":
      return activeTurn.lifecycle.kind === "running" && Boolean(action.item.turnId) && action.item.turnId !== activeTurnId;
    case "thread-stream/pending-steer-committed":
      return activeTurnId !== null && Boolean(action.item.turnId) && action.item.turnId !== activeTurnId;
    default:
      return false;
  }
}

function splitViewState(activeTurn: ChatActiveTurnState, view: ChatThreadStreamViewState): TurnScopeResult {
  const nextActiveTurn =
    view.activeSegment === activeTurn.activeSegment && view.pendingSteers === activeTurn.pendingSteers
      ? activeTurn
      : { ...activeTurn, activeSegment: view.activeSegment, pendingSteers: view.pendingSteers };
  return { activeTurn: nextActiveTurn, threadStream: withoutActiveState(view) };
}

function withoutActiveState(view: ChatThreadStreamViewState): ChatThreadStreamState {
  return {
    stableItems: view.stableItems,
    turnDiffs: view.turnDiffs,
    historyCursor: view.historyCursor,
    loadingHistory: view.loadingHistory,
    reportedLogs: view.reportedLogs,
  };
}
