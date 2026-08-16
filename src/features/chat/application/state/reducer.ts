import type { ReasoningEffort } from "../../../../domain/catalog/metadata";
import type { ThreadTokenUsage } from "../../../../domain/runtime/metrics";
import type { ApprovalsReviewer } from "../../../../domain/runtime/policy";
import type { RuntimeSettingsPatch } from "../../../../domain/runtime/thread-settings";
import type { Diagnostics } from "../../../../domain/server/diagnostics";
import type { ServerInitialization } from "../../../../domain/server/initialization";
import type { CollaborationModeSelection, RequestedFastMode } from "../../domain/runtime/intent";
import {
  type ChatRuntimeState,
  clearRequestedApprovalsReviewerRuntimeState,
  clearRequestedFastModeRuntimeState,
  commitAppliedRuntimeSettingsPatchState,
  requestApprovalsReviewerRuntimeState,
  requestFastModeRuntimeState,
  requestModelRuntimeState,
  requestPermissionProfileRuntimeState,
  requestReasoningEffortRuntimeState,
  resetModelToConfigRuntimeState,
  resetPermissionProfileToConfigRuntimeState,
  resetReasoningEffortToConfigRuntimeState,
  setSelectedCollaborationModeRuntimeState,
} from "../../domain/runtime/state";
import { isRequestAction, type RequestAction, reduceRequestSlice } from "../pending-requests/state";
import { type ComposerAction, reduceComposerSlice } from "./composer";
import type { ChatConnectionPhase, ChatConnectionState, ChatPanelThreadState, ChatState } from "./model";
import { definedPatch, patchObject } from "./patch";
import type { SubagentActivityAction } from "./subagent-activity";
import type { ThreadStreamAction } from "./thread-stream";
import type { ChatTransitionAction } from "./transition-actions";
import { reduceChatTransition } from "./transitions";
import { isTurnScopeAction, reduceTurnScope } from "./turn-scope";
import { isUiAction, reduceUiSlice, type UiAction } from "./ui";

type ConnectionAction =
  | { type: "connection/status-set"; statusText: string; phase?: ChatConnectionPhase }
  | { type: "connection/initialized"; initializeResponse: ServerInitialization }
  | { type: "connection/diagnostics-applied"; serverDiagnostics: Diagnostics };

type ActiveThreadAction = { type: "active-thread/token-usage-set"; tokenUsage: ThreadTokenUsage | null };

type RuntimeAction =
  | { type: "runtime/model-requested"; model: string }
  | { type: "runtime/model-reset-to-config" }
  | { type: "runtime/reasoning-effort-requested"; effort: ReasoningEffort | null }
  | { type: "runtime/reasoning-effort-reset-to-config" }
  | { type: "runtime/permission-profile-requested"; permissionProfile: string }
  | { type: "runtime/permission-profile-reset-to-config" }
  | { type: "runtime/fast-mode-requested"; fastMode: RequestedFastMode }
  | { type: "runtime/fast-mode-request-cleared" }
  | { type: "runtime/approvals-reviewer-requested"; approvalsReviewer: ApprovalsReviewer }
  | { type: "runtime/approvals-reviewer-request-cleared" }
  | { type: "runtime/requested-collaboration-mode-set"; collaborationMode: CollaborationModeSelection }
  | { type: "runtime/pending-thread-settings-committed"; update: RuntimeSettingsPatch };

type ChatSliceAction =
  | ConnectionAction
  | ActiveThreadAction
  | RuntimeAction
  | RequestAction
  | ThreadStreamAction
  | SubagentActivityAction
  | ComposerAction
  | UiAction;

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
    case "runtime/model-requested":
    case "runtime/model-reset-to-config":
    case "runtime/reasoning-effort-requested":
    case "runtime/reasoning-effort-reset-to-config":
    case "runtime/permission-profile-requested":
    case "runtime/permission-profile-reset-to-config":
    case "runtime/fast-mode-requested":
    case "runtime/fast-mode-request-cleared":
    case "runtime/approvals-reviewer-requested":
    case "runtime/approvals-reviewer-request-cleared":
    case "runtime/requested-collaboration-mode-set":
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

function reduceGuardedSlice(state: ChatState, action: RequestAction | ThreadStreamAction | SubagentActivityAction | UiAction): ChatState {
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
    case "runtime/model-requested":
      return patchObject(state, requestModelRuntimeState(state, action.model));
    case "runtime/model-reset-to-config":
      return patchObject(state, resetModelToConfigRuntimeState(state));
    case "runtime/reasoning-effort-requested":
      return patchObject(state, requestReasoningEffortRuntimeState(state, action.effort));
    case "runtime/reasoning-effort-reset-to-config":
      return patchObject(state, resetReasoningEffortToConfigRuntimeState(state));
    case "runtime/permission-profile-requested":
      return patchObject(state, requestPermissionProfileRuntimeState(state, action.permissionProfile));
    case "runtime/permission-profile-reset-to-config":
      return patchObject(state, resetPermissionProfileToConfigRuntimeState(state));
    case "runtime/fast-mode-requested":
      return patchObject(state, requestFastModeRuntimeState(state, action.fastMode));
    case "runtime/fast-mode-request-cleared":
      return patchObject(state, clearRequestedFastModeRuntimeState(state));
    case "runtime/approvals-reviewer-requested":
      return patchObject(state, requestApprovalsReviewerRuntimeState(state, action.approvalsReviewer));
    case "runtime/approvals-reviewer-request-cleared":
      return patchObject(state, clearRequestedApprovalsReviewerRuntimeState(state));
    case "runtime/requested-collaboration-mode-set":
      return patchObject(state, setSelectedCollaborationModeRuntimeState(state, action.collaborationMode));
    case "runtime/pending-thread-settings-committed":
      return patchObject(state, commitAppliedRuntimeSettingsPatchState(state, action.update));
  }
}
