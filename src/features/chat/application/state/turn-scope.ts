import type { UserThreadStreamDialogueItem } from "../../domain/thread-stream/items";
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
  threadStreamActiveState,
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

export function activeTurnStarted(state: ChatActiveTurnState, threadStream: ChatThreadStreamState, turnId: string): TurnScopeResult {
  // Rows for the newly identified turn may already exist in loaded history or in the provisional segment.
  const stableItems = threadStream.stableItems.filter((item) => item.turnId !== turnId);
  const activeItems = threadStream.stableItems.filter((item) => item.turnId === turnId);
  for (const item of state.activeSegment?.items ?? []) {
    if (item.turnId === turnId || (!item.turnId && state.lifecycle.kind === "starting")) activeItems.push(item);
    else stableItems.push(item);
  }
  return {
    threadStream: patchObject(threadStream, { stableItems }),
    activeTurn: {
      ...initialChatActiveTurnState(),
      lifecycle: { kind: "running", turnId },
      ...threadStreamActiveState(turnId, activeItems, state.pendingSteers),
    },
  };
}

export function activeTurnOptimisticallyStarted(state: ChatActiveTurnState, item: UserThreadStreamDialogueItem): ChatActiveTurnState {
  return {
    ...initialChatActiveTurnState(),
    lifecycle: { kind: "starting", anchorItemId: item.id },
    ...threadStreamActiveState(null, [item], state.pendingSteers),
  };
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

  return reduceThreadStream(activeTurn, threadStream, action);
}

export function reduceThreadStream(
  activeTurn: ChatActiveTurnState,
  threadStream: ChatThreadStreamState,
  action: ThreadStreamAction,
): TurnScopeResult {
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
    case "thread-stream/user-message-observed":
      return activeTurn.lifecycle.kind === "running" && Boolean(action.item.turnId) && action.item.turnId !== activeTurnId;
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
