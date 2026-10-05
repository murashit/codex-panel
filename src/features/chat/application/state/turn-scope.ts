import type { ThreadStreamItem, UserThreadStreamDialogueItem } from "../../domain/thread-stream/items";
import type { AuthRecoveryProgress } from "../turns/auth-recovery";
import type { ChatTurnLifecycleState } from "../turns/turn-state";
import { patchObject } from "./patch";
import {
  type ChatSubagentActivityState,
  initialSubagentActivityState,
  reduceSubagentActivitySlice,
  type SubagentActivityAction,
} from "./subagent-activity";
import {
  type ChatThreadStreamActiveState,
  type ChatThreadStreamState,
  type ChatThreadStreamViewState,
  reduceThreadStreamSlice,
  type ThreadStreamAction,
  threadStreamItems,
  threadStreamStartActiveSegment,
  threadStreamWithActiveTurnItems,
} from "./thread-stream";

export interface ChatActiveTurnState extends ChatThreadStreamActiveState {
  readonly lifecycle: ChatTurnLifecycleState;
  readonly subagents: ChatSubagentActivityState;
  readonly authRecovery: AuthRecoveryProgress | null;
}

type AuthRecoveryAction =
  | { type: "auth-recovery/updated"; turnId: string; progress: AuthRecoveryProgress }
  | { type: "auth-recovery/cleared" };

export type TurnScopeAction = ThreadStreamAction | SubagentActivityAction | AuthRecoveryAction;

export interface TurnScopeResult {
  readonly activeTurn: ChatActiveTurnState;
  readonly threadStream: ChatThreadStreamState;
}

export function initialChatActiveTurnState(): ChatActiveTurnState {
  const lifecycle: ChatTurnLifecycleState = { kind: "idle" };
  return {
    lifecycle,
    activeSegment: null,
    pendingSteers: [],
    subagents: initialSubagentActivityState(),
    authRecovery: null,
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
      ? { activeSegment: null, pendingSteers: [], subagents: initialSubagentActivityState(), authRecovery: null }
      : scopeChanged
        ? { subagents: initialSubagentActivityState(), authRecovery: null }
        : {};
  return {
    ...state,
    ...transientReset,
    lifecycle,
  };
}

function sameTurnScope(left: ChatTurnLifecycleState, right: ChatTurnLifecycleState): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "starting" && right.kind === "starting") {
    return left.anchorItemId === right.anchorItemId;
  }
  if (left.kind === "running" && right.kind === "running") return left.turnId === right.turnId;
  return true;
}

export function activeTurnStarted(
  state: ChatActiveTurnState,
  threadStream: ChatThreadStreamState,
  turnId: string,
  items?: readonly ThreadStreamItem[],
): TurnScopeResult {
  const view = chatThreadStreamViewState(threadStream, state);
  const nextView = threadStreamWithActiveTurnItems(view, turnId, items ?? threadStreamItems(view));
  return splitViewState(state, threadStream, nextView);
}

export function activeTurnOptimisticallyStarted(
  state: ChatActiveTurnState,
  threadStream: ChatThreadStreamState,
  item: UserThreadStreamDialogueItem,
): TurnScopeResult {
  const view = chatThreadStreamViewState(threadStream, state);
  return splitViewState(state, threadStream, threadStreamStartActiveSegment(view, null, [item]));
}

export function reduceTurnScope(
  activeTurn: ChatActiveTurnState,
  threadStream: ChatThreadStreamState,
  action: TurnScopeAction,
): TurnScopeResult {
  if (action.type === "auth-recovery/updated") {
    const activeTurnId = activeTurn.lifecycle.kind === "running" ? activeTurn.lifecycle.turnId : null;
    return activeTurnId === action.turnId
      ? { activeTurn: { ...activeTurn, authRecovery: action.progress }, threadStream }
      : { activeTurn, threadStream };
  }
  if (action.type === "auth-recovery/cleared") {
    return activeTurn.authRecovery ? { activeTurn: { ...activeTurn, authRecovery: null }, threadStream } : { activeTurn, threadStream };
  }
  switch (action.type) {
    case "subagent-activity/tracked":
    case "subagent-activity/coordination-observed":
    case "subagent-activity/runtime-fact":
      return reduceSubagentAction(activeTurn, threadStream, action);
  }
  if (staleThreadStreamAction(activeTurn, action)) {
    return { activeTurn, threadStream };
  }

  const nextView = reduceThreadStreamSlice(chatThreadStreamViewState(threadStream, activeTurn), action);
  return splitViewState(activeTurn, threadStream, nextView);
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
      return action.turnId !== activeTurnId;
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

function splitViewState(
  activeTurn: ChatActiveTurnState,
  threadStream: ChatThreadStreamState,
  view: ChatThreadStreamViewState,
): TurnScopeResult {
  return {
    activeTurn: patchObject(activeTurn, { activeSegment: view.activeSegment, pendingSteers: view.pendingSteers }),
    threadStream: patchObject(threadStream, {
      stableItems: view.stableItems,
      turnDiffs: view.turnDiffs,
      historyCursor: view.historyCursor,
      loadingHistory: view.loadingHistory,
      reportedLogs: view.reportedLogs,
    }),
  };
}
