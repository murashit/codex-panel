import type { ModelMetadata, ReasoningEffort } from "../../../../domain/runtime/catalog";
import type { RuntimeConfigSnapshot } from "../../../../domain/runtime/settings";
import type { RateLimitSnapshot } from "../../../../domain/runtime/usage";
import { activePanelOperationDecision } from "../../application/panel-operation-policy";
import { runtimeSnapshotForChatSlices, threadStreamItemsHaveThreadTurns } from "../../application/runtime/snapshot";
import {
  activeThreadState,
  type ChatActiveThreadState,
  type ChatState,
  isSideChatLifetime,
  panelThreadProvenance,
} from "../../application/state/model";
import { threadStreamItems } from "../../application/state/thread-stream";
import { chatThreadStreamViewState } from "../../application/state/turn-scope";
import { activeTurnId, chatTurnBusy } from "../../application/turns/turn-state";
import type { RuntimeSnapshot } from "../../domain/runtime/snapshot";
import type { ComposerShellProps } from "../../ui/composer/composer";
import { composerPresentation } from "../../ui/composer/presentation";

export interface ChatPanelComposerRuntimeActions {
  requestModel: (model: string) => Promise<void>;
  requestReasoningEffort: (effort: ReasoningEffort) => Promise<void>;
}

export interface ChatPanelComposerPresenter {
  renderState(model: ChatPanelComposerModel, actions: ChatPanelComposerActions): ComposerShellProps;
}

export interface ChatPanelComposerActions {
  submit: () => void;
  cancelFork?: () => void;
}

export function projectChatPanelComposer(model: ChatPanelComposerModel, actions: ChatPanelComposerRuntimeActions) {
  return composerPresentation(
    {
      snapshot: model,
      disconnected: model.connectionPhase.kind === "failed" || model.connectionPhase.kind === "disconnected",
      sideChatActive: model.sideChatActive,
      inputRestriction:
        model.canAcceptDirectInput === false
          ? "read-only"
          : model.activeThreadSubagent && model.canAcceptDirectInput === null
            ? "agent-unknown"
            : null,
    },
    actions,
  );
}

export interface ChatPanelComposerSharedValues {
  readonly runtimeConfig: RuntimeConfigSnapshot | null;
  readonly models: readonly ModelMetadata[];
  readonly rateLimit: RateLimitSnapshot | null;
}

export interface ChatPanelComposerModel extends RuntimeSnapshot {
  readonly connectionPhase: ChatState["connection"]["phase"];
  readonly sideChatActive: boolean;
  readonly forkDraft: boolean;
  readonly draft: ChatState["composer"]["draft"];
  readonly attachmentSavePending: boolean;
  readonly suggestions: ChatState["composer"]["suggestions"];
  readonly selectedSuggestionIndex: ChatState["composer"]["suggestSelected"];
  readonly activeThreadSubagent: boolean;
  readonly canAcceptDirectInput: ChatActiveThreadState["canAcceptDirectInput"];
  readonly submissionBlockedByPanelPolicy: boolean;
  readonly runtimeSettingsDisabled: boolean;
  readonly webSubmissionPending: boolean;
  readonly webSubmissionCancellable: boolean;
  readonly turnBusy: boolean;
  readonly activeTurnId: string | null;
}

export function selectChatPanelComposer(state: ChatState, shared: ChatPanelComposerSharedValues): ChatPanelComposerModel {
  const activeThread = activeThreadState(state);
  const lifetime = activeThread?.lifetime;
  const draft = state.panelThread.kind === "fork-draft" ? state.panelThread.draft : null;
  const sideChat = draft?.kind === "side-chat" ? draft : isSideChatLifetime(lifetime) ? lifetime : null;
  return {
    ...runtimeSnapshotForChatSlices({
      runtimeConfig: shared.runtimeConfig,
      activeThread: { id: activeThread?.id ?? null, tokenUsage: activeThread?.tokenUsage ?? null },
      runtime: state.runtime,
      rateLimit: shared.rateLimit,
      hasThreadTurns: hasThreadTurns(state),
      availableModels: shared.models,
    }),
    connectionPhase: state.connection.phase,
    sideChatActive: sideChat !== null,
    forkDraft: state.panelThread.kind === "fork-draft",
    draft: state.composer.draft,
    attachmentSavePending: state.composer.pendingAttachmentSaveIds.length > 0,
    suggestions: state.composer.suggestions,
    selectedSuggestionIndex: state.composer.suggestSelected,
    activeThreadSubagent: panelThreadProvenance(state)?.kind === "subagent",
    canAcceptDirectInput: activeThread?.canAcceptDirectInput ?? null,
    submissionBlockedByPanelPolicy: activePanelOperationDecision(state, "submit").kind === "blocked",
    runtimeSettingsDisabled: activePanelOperationDecision(state, "thread-settings").kind !== "allowed",
    webSubmissionPending: state.pendingSubmission !== null,
    webSubmissionCancellable: state.pendingSubmission?.phase === "cancellable",
    turnBusy: chatTurnBusy(state.activeTurn),
    activeTurnId: activeTurnId(state.activeTurn),
  };
}

function hasThreadTurns(state: ChatState): boolean {
  const stream = chatThreadStreamViewState(state.threadStream, state.activeTurn);
  return threadStreamItemsHaveThreadTurns(threadStreamItems(stream));
}
