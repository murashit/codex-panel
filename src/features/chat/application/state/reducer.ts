import type { ServerInitialization } from "../../../../domain/runtime/metadata";
import type { RuntimeSettingsPatch } from "../../../../domain/runtime/settings";
import type { ThreadTokenUsage } from "../../../../domain/runtime/usage";
import { type ChatRuntimeState, commitAppliedRuntimeSettingsPatchState, type PendingRuntimeIntentState } from "../../domain/runtime/state";
import { type RequestAction, reduceRequestSlice } from "../pending-requests/state";
import { type ComposerAction, reduceComposerSlice } from "./composer";
import type { ChatConnectionPhase, ChatConnectionState, ChatPanelThreadState, ChatState } from "./model";
import { definedPatch, patchObject } from "./patch";
import type { ChatTransitionAction } from "./transition-actions";
import { reduceChatTransition } from "./transitions";
import { reduceTurnScope, type TurnScopeAction } from "./turn-scope";
import { reduceUiSlice, type UiAction } from "./ui";

type ConnectionAction =
  | { type: "connection/status-set"; statusText: string; phase?: ChatConnectionPhase }
  | { type: "connection/initialized"; initializeResponse: ServerInitialization };

type ActiveThreadAction = { type: "active-thread/token-usage-set"; tokenUsage: ThreadTokenUsage | null };

type RuntimeAction =
  | { type: "runtime/pending-intent-patched"; patch: Partial<PendingRuntimeIntentState> }
  | { type: "runtime/pending-thread-settings-committed"; update: RuntimeSettingsPatch };

type ChatSliceAction = ConnectionAction | ActiveThreadAction | RuntimeAction | RequestAction | TurnScopeAction | ComposerAction | UiAction;

export type ChatAction = ChatTransitionAction | ChatSliceAction;

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "panel/fork-operation-set":
    case "panel/fork-draft-applied":
    case "active-thread/fork-replacement-settled":
    case "connection/scoped-cleared":
    case "active-thread/cleared":
    case "active-thread/created":
    case "active-thread/resumed":
    case "active-thread/settings-applied":
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
  switch (action.type) {
    case "request/approval-queued":
    case "request/user-input-queued":
    case "request/user-input-auto-resolution-extended":
    case "request/mcp-elicitation-queued":
    case "request/user-input-draft-set":
    case "request/mcp-elicitation-draft-set":
      return patchObject(state, { requests: reduceRequestSlice(state.requests, action) });
    case "thread-stream/item-added":
    case "thread-stream/system-item-added":
    case "thread-stream/deduped-log-added":
    case "thread-stream/history-loading-set":
    case "thread-stream/content-replaced":
    case "thread-stream/item-upserted":
    case "thread-stream/pending-steer-added":
    case "thread-stream/pending-steer-removed":
    case "thread-stream/pending-steer-committed":
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
    default: {
      const unhandledAction: never = action;
      return unhandledAction;
    }
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
