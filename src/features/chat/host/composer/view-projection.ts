import type { ModelMetadata, ReasoningEffort } from "../../../../domain/catalog/metadata";
import type { RuntimeConfigSnapshot } from "../../../../domain/runtime/config";
import type { RateLimitSnapshot } from "../../../../domain/runtime/metrics";
import type { Thread } from "../../../../domain/threads/model";
import { explicitThreadName } from "../../../../domain/threads/model";
import { activePanelOperationDecision } from "../../application/panel-operation-policy";
import { runtimeSnapshotForChatSlices, threadStreamItemsHaveThreadTurns } from "../../application/runtime/snapshot";
import { activeThreadState, type ChatActiveThreadState, type ChatState, panelThreadProvenance } from "../../application/state/model";
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
}

export function projectChatPanelComposer(model: ChatPanelComposerModel, actions: ChatPanelComposerRuntimeActions) {
  return composerPresentation(
    {
      snapshot: model,
      disconnected: model.connectionPhase.kind === "failed" || model.connectionPhase.kind === "disconnected",
      threadName: model.activeThreadId ? model.activeListedThreadName : null,
      sideChatActive: model.sideChatActive,
      sideChatSourceTitle: model.sideChatSourceTitle,
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
  readonly threads: readonly Thread[];
  readonly runtimeConfig: RuntimeConfigSnapshot | null;
  readonly models: readonly ModelMetadata[];
  readonly rateLimit: RateLimitSnapshot | null;
}

export interface ChatPanelComposerModel extends RuntimeSnapshot {
  readonly connectionPhase: ChatState["connection"]["phase"];
  readonly activeListedThreadName: string | null;
  readonly sideChatActive: boolean;
  readonly sideChatSourceTitle: string | null;
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
  const activeThreadId = activeThread?.id ?? null;
  const lifetime = activeThread?.lifetime;
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
    activeListedThreadName: activeThreadId ? projectedThreadName(shared, activeThreadId) : null,
    sideChatActive: lifetime?.kind === "ephemeral",
    sideChatSourceTitle: lifetime?.kind === "ephemeral" ? lifetime.sourceThreadTitle : null,
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

function projectedThreadName(shared: ChatPanelComposerSharedValues, threadId: string): string | null {
  const thread = shared.threads.find((item) => item.id === threadId);
  return thread ? explicitThreadName(thread) : null;
}
