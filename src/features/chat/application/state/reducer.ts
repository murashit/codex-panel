import { definedPatch } from "../../../../domain/objects/optional-properties";
import type { ServerInitialization } from "../../../../domain/runtime/metadata";
import type { ThreadTokenUsage } from "../../../../domain/runtime/usage";
import type { ThreadReadReceipt } from "../../../../domain/threads/model";
import { type ChatRuntimeState, confirmRuntimeIntentState, type PendingRuntimeIntentState } from "../../domain/runtime/state";
import { type RequestAction, reduceRequestSlice } from "../pending-requests/state";
import { type ComposerAction, reduceComposerSlice } from "./composer";
import type { ChatConnectionPhase, ChatConnectionState, ChatPanelThreadState, ChatState } from "./model";
import { patchObject } from "./patch";
import type { ChatTransitionAction } from "./transition-actions";
import { reduceChatTransition } from "./transitions";
import { reduceTurnScope, type TurnScopeAction } from "./turn-scope";
import { reduceUiSlice, type UiAction } from "./ui";

type ConnectionAction =
  | { type: "connection/status-set"; statusText: string; phase?: ChatConnectionPhase }
  | { type: "connection/initialized"; initializeResponse: ServerInitialization };

type ActiveThreadAction =
  | { type: "active-thread/token-usage-set"; tokenUsage: ThreadTokenUsage | null }
  | { type: "active-thread/read-receipt-set"; receipt: ThreadReadReceipt | null };

type RuntimeAction =
  | { type: "runtime/pending-intent-patched"; patch: Partial<PendingRuntimeIntentState> }
  | { type: "runtime/pending-intent-confirmed"; intents: Partial<PendingRuntimeIntentState> };

type ChatSliceAction = ConnectionAction | ActiveThreadAction | RuntimeAction | RequestAction | TurnScopeAction | ComposerAction | UiAction;

export type ChatAction = ChatTransitionAction | ChatSliceAction;

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "connection/status-set":
    case "connection/initialized":
      return patchObject(state, { connection: reduceConnectionSlice(state.connection, action) });
    case "active-thread/read-receipt-set":
      return patchObject(state, { threadReadReceipt: action.receipt });
    case "active-thread/token-usage-set":
      return patchObject(state, { panelThread: reducePanelThreadSlice(state.panelThread, action.tokenUsage) });
    case "runtime/pending-intent-patched":
    case "runtime/pending-intent-confirmed":
      return patchObject(state, { runtime: reduceRuntimeSlice(state.runtime, action) });
    case "composer/draft-set":
    case "composer/input-set":
    case "composer/suggestions-set":
      return patchObject(state, { composer: reduceComposerSlice(state.composer, action) });
    case "request/approval-queued":
    case "request/user-input-timeout-failed":
    case "request/user-input-queued":
    case "request/mcp-elicitation-queued":
    case "request/user-input-draft-set":
    case "request/mcp-elicitation-field-set":
      return patchObject(state, { requests: reduceRequestSlice(state.requests, action) });
    case "thread-stream/item-added":
    case "thread-stream/system-item-added":
    case "thread-stream/deduped-log-added":
    case "thread-stream/history-loading-set":
    case "thread-stream/history-loaded":
    case "thread-stream/item-upserted":
    case "thread-stream/pending-steer-added":
    case "thread-stream/pending-steer-removed":
    case "thread-stream/user-message-observed":
    case "thread-stream/reasoning-completed":
    case "thread-stream/assistant-delta-appended":
    case "thread-stream/plan-delta-appended":
    case "thread-stream/item-text-appended":
    case "thread-stream/tool-output-appended":
    case "thread-stream/item-output-appended":
    case "thread-stream/turn-diff-updated":
    case "subagent-activity/tracked":
    case "subagent-activity/coordination-observed":
    case "subagent-activity/runtime-fact":
    case "auth-recovery/updated":
    case "auth-recovery/cleared": {
      const turnScope = reduceTurnScope(state.activeTurn, state.threadStream, action);
      return patchObject(state, { activeTurn: turnScope.activeTurn, threadStream: turnScope.threadStream });
    }
    case "ui/panel-set":
    case "ui/archive-confirm-set":
    case "ui/rename-set":
    case "ui/goal-editor-started":
    case "ui/goal-editor-draft-updated":
    case "ui/goal-editor-closed":
    case "ui/thread-stream-fork-menu-set":
    case "ui/disclosure-set":
      return patchObject(state, { ui: reduceUiSlice(state.ui, action) });
    default:
      return reduceChatTransition(state, action);
  }
}

function reduceConnectionSlice(state: ChatConnectionState, action: ConnectionAction): ChatConnectionState {
  switch (action.type) {
    case "connection/status-set":
      return patchObject(state, { statusText: action.statusText, ...definedPatch("phase", action.phase) });
    case "connection/initialized":
      return patchObject(state, { initializeResponse: action.initializeResponse });
  }
}

function reducePanelThreadSlice(state: ChatPanelThreadState, tokenUsage: ThreadTokenUsage | null): ChatPanelThreadState {
  if (state.kind !== "active") return state;
  return patchObject(state, { thread: patchObject(state.thread, { tokenUsage }) });
}

function reduceRuntimeSlice(state: ChatRuntimeState, action: RuntimeAction): ChatRuntimeState {
  switch (action.type) {
    case "runtime/pending-intent-patched":
      return patchObject(state, { pending: patchObject(state.pending, action.patch) });
    case "runtime/pending-intent-confirmed":
      return patchObject(state, confirmRuntimeIntentState(state, action.intents));
  }
}
