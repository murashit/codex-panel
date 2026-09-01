import type { ThreadTokenUsage } from "../../../../domain/runtime/metrics";
import type { RuntimeSettingsPatch } from "../../../../domain/runtime/thread-settings";
import type { Diagnostics } from "../../../../domain/server/diagnostics";
import type { ServerInitialization } from "../../../../domain/server/initialization";
import { type ChatRuntimeState, commitAppliedRuntimeSettingsPatchState, type PendingRuntimeIntentState } from "../../domain/runtime/state";
import { isRequestAction, type RequestAction, reduceRequestSlice } from "../pending-requests/state";
import { type ComposerAction, reduceComposerSlice } from "./composer";
import type { ChatConnectionPhase, ChatConnectionState, ChatPanelThreadState, ChatState } from "./model";
import { definedPatch, patchObject } from "./patch";
import type { ChatTransitionAction } from "./transition-actions";
import { reduceChatTransition } from "./transitions";
import { isTurnScopeAction, reduceTurnScope, type TurnScopeAction } from "./turn-scope";
import { isUiAction, reduceUiSlice, type UiAction } from "./ui";

type ConnectionAction =
  | { type: "connection/status-set"; statusText: string; phase?: ChatConnectionPhase }
  | { type: "connection/initialized"; initializeResponse: ServerInitialization }
  | { type: "connection/diagnostics-applied"; serverDiagnostics: Diagnostics };

type ActiveThreadAction = { type: "active-thread/token-usage-set"; tokenUsage: ThreadTokenUsage | null };

type RuntimeAction =
  | { type: "runtime/pending-intent-patched"; patch: Partial<PendingRuntimeIntentState> }
  | { type: "runtime/pending-thread-settings-committed"; update: RuntimeSettingsPatch };

type ChatSliceAction = ConnectionAction | ActiveThreadAction | RuntimeAction | RequestAction | TurnScopeAction | ComposerAction | UiAction;

export type ChatAction = ChatTransitionAction | ChatSliceAction;

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "connection/scoped-cleared":
    case "active-thread/cleared":
    case "active-thread/resumed":
    case "active-thread/settings-applied":
    case "active-thread/goal-set":
    case "panel/restored-thread-applied":
    case "panel/restored-thread-renamed":
    case "panel/view-state-cleared":
    case "turn/started":
    case "turn/completed":
    case "turn/scoped-cleared":
    case "turn/optimistic-started":
    case "turn/start-acknowledged":
    case "turn/start-failed":
    case "turn/pending-start-hook-upserted":
    case "request/resolved":
    case "web-submission/pending":
    case "web-submission/committed":
    case "web-submission/cancelled":
    case "web-submission/failed":
    case "web-submission/steer-pending":
      return reduceChatTransition(state, action);
    default:
      return reduceChatSlice(state, action);
  }
}

function reduceChatSlice(state: ChatState, action: ChatSliceAction): ChatState {
  switch (action.type) {
    case "connection/status-set":
    case "connection/initialized":
    case "connection/diagnostics-applied":
      return patchObject(state, { connection: reduceConnectionSlice(state.connection, action) });
    case "active-thread/token-usage-set":
      return patchObject(state, { panelThread: reducePanelThreadSlice(state.panelThread, action) });
    case "runtime/pending-intent-patched":
    case "runtime/pending-thread-settings-committed":
      return patchObject(state, { runtime: reduceRuntimeSlice(state.runtime, action) });
    case "composer/attachment-save-started":
    case "composer/attachment-save-settled":
    case "composer/draft-set":
    case "composer/input-set":
    case "composer/suggestions-set":
      return patchObject(state, { composer: reduceComposerSlice(state.composer, action) });
    default:
      return reduceGuardedSlice(state, action);
  }
}

function reduceGuardedSlice(state: ChatState, action: RequestAction | TurnScopeAction | UiAction): ChatState {
  if (isRequestAction(action)) return patchObject(state, { requests: reduceRequestSlice(state.requests, action) });
  if (isTurnScopeAction(action)) {
    const turnScope = reduceTurnScope(state.activeTurn, state.threadStream, action);
    return patchObject(state, { activeTurn: turnScope.activeTurn, threadStream: turnScope.threadStream });
  }
  if (isUiAction(action)) return patchObject(state, { ui: reduceUiSlice(state.ui, action) });
  return state;
}

function reduceConnectionSlice(state: ChatConnectionState, action: ConnectionAction): ChatConnectionState {
  switch (action.type) {
    case "connection/status-set":
      return patchObject(state, { statusText: action.statusText, ...definedPatch("phase", action.phase) });
    case "connection/initialized":
      return patchObject(state, { initializeResponse: action.initializeResponse });
    case "connection/diagnostics-applied":
      return patchObject(state, { serverDiagnostics: action.serverDiagnostics });
  }
}

function reducePanelThreadSlice(state: ChatPanelThreadState, action: ActiveThreadAction): ChatPanelThreadState {
  if (state.kind !== "active") return state;
  return patchObject(state, { thread: patchObject(state.thread, { tokenUsage: action.tokenUsage }) });
}

function reduceRuntimeSlice(state: ChatRuntimeState, action: RuntimeAction): ChatRuntimeState {
  switch (action.type) {
    case "runtime/pending-intent-patched":
      return patchObject(state, { pending: patchObject(state.pending, action.patch) });
    case "runtime/pending-thread-settings-committed":
      return patchObject(state, commitAppliedRuntimeSettingsPatchState(state, action.update));
  }
}
