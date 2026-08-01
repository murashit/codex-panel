import type { SkillMetadata } from "../../../../domain/catalog/metadata";
import { isComposerSendKey, type SendShortcut } from "../../../../domain/input/send-shortcut";
import { runtimeConfigOrDefault } from "../../../../domain/runtime/config";
import type { RuntimePermissionProfileSummary } from "../../../../domain/runtime/permissions";
import type { Thread } from "../../../../domain/threads/model";
import { type ComposerAttachmentHandler, codexInputWithComposerAttachments } from "../../application/composer/attachments";
import type { ComposerBoundaryScrollAction } from "../../application/composer/boundary-scroll";
import {
  type ActiveNoteContextReference,
  activeNoteContextReferenceMarker,
  type ComposerContextReferenceProvider,
  type SelectionContextReference,
  selectionContextReferenceMarker,
} from "../../application/composer/context-references";
import type { FuzzyMatcher } from "../../application/composer/fuzzy-search";
import type { ComposerInputSnapshot } from "../../application/composer/input-snapshot";
import type { NoteCandidate, NoteCandidateProvider } from "../../application/composer/note-context";
import type { ComposerRuntimeSnapshot } from "../../application/composer/runtime-snapshot";
import type { ComposerSubmissionClaim } from "../../application/composer/submission-claim";
import type { ComposerSuggestion } from "../../application/composer/suggestion";
import {
  activeComposerSuggestions,
  applyComposerSuggestionInsertion,
  composerSuggestionNavigationDirection,
  nextComposerSuggestionIndex,
} from "../../application/composer/suggestions";
import {
  type PreparedComposerInput,
  preparedUserInputWithWikiLinkReferencesSkillsAndContext,
} from "../../application/composer/wikilink-context";
import { activePanelOperationDecision } from "../../application/panel-operation-policy";
import { type ChatRuntimeSharedResources, runtimeSnapshotForChatState } from "../../application/runtime/snapshot";
import { activePanelOperationForSlashCommandSuggestion } from "../../application/slash-commands/catalog";
import { type ThreadCommandTarget, threadCommandTargetForDraft } from "../../application/slash-commands/thread-arguments";
import {
  capturePanelTargetLease,
  type PanelTargetLease,
  panelTargetLeaseIsCurrent,
  panelTargetLeasesMatch,
} from "../../application/state/panel-target";
import { activeThreadState, type ChatAction, type ChatState, panelThreadId } from "../../application/state/root-reducer";
import type { ChatStateStore } from "../../application/state/store";
import { resolveRuntimeControls } from "../../domain/runtime/resolution";
import type { ComposerCallbacks, ComposerPendingSelection, ComposerShellProps } from "../../ui/composer";
import { syncComposerHeight } from "../../ui/composer.dom";
import type { ChatPanelComposerModel } from "../shell/selectors";
import { ComposerAttachmentTransfers } from "./attachment-transfers";
import {
  applyComposerInsertionToElement,
  composerBoundaryScrollActionFromElement,
  composerFilesFromTransfer,
  composerHasFocus,
  composerInsertionSource,
  composerSuggestionSignatureFromElement,
  composerTextBeforeCursor,
  composerTransferHasFiles,
  focusComposer,
} from "./element.dom";
import { type ChatPanelComposerRuntimeActions, projectChatPanelComposer } from "./view-projection";

interface ChatComposerControllerOptions {
  fuzzyMatcher: FuzzyMatcher;
  noteCandidateProvider: NoteCandidateProvider;
  contextReferenceProvider: ComposerContextReferenceProvider;
  attachmentHandler: ComposerAttachmentHandler;
  sourcePath: () => string;
  stateStore: ChatStateStore;
  viewId: string;
  referenceActiveNoteOnSend: () => boolean;
  sendShortcut: () => SendShortcut;
  scrollThreadFromComposerEdges: () => boolean;
  runtimeActions: ChatPanelComposerRuntimeActions;
  threadScrollFromComposer: (action: ComposerBoundaryScrollAction) => void;
  togglePlan: () => void;
  toggleAutoReview: () => void;
  toggleFast: () => void;
  canFocus: () => boolean;
  onAttachmentError: (message: string) => void;
  sharedResources: ChatRuntimeSharedResources & {
    skillsSnapshot(): readonly SkillMetadata[] | null;
    permissionProfilesSnapshot(): readonly RuntimePermissionProfileSummary[] | null;
    activeThreadsSnapshot(): readonly Thread[] | null;
    subscribe(listener: () => void): () => void;
  };
}

interface ChatComposerRenderActions {
  submit: () => void;
}

interface ActiveComposerSubmissionClaim {
  readonly claim: ComposerSubmissionClaim;
  panelTarget: PanelTargetLease;
  phase: "preflight" | "adopted";
  targetAdoption: { targetThreadId: string | null; replacementDraft?: string } | null;
}

function composerCanInterrupt(model: ChatPanelComposerModel): boolean {
  return model.turnBusy && Boolean(model.activeThreadId && model.activeTurnId);
}

export class ChatComposerController {
  private composer: HTMLTextAreaElement | null = null;
  private readonly attachmentTransfers: ComposerAttachmentTransfers;
  private activeNoteContextSnapshots: ActiveNoteContextReference[] = [];
  private selectionContextSnapshots: SelectionContextReference[] = [];
  private threadCommandTarget: ThreadCommandTarget | null = null;
  private activeSubmissionClaim: ActiveComposerSubmissionClaim | null = null;
  private pendingSelection: ComposerPendingSelection | null = null;
  private readonly unsubscribeState: () => void;
  private readonly unsubscribeSharedResources: () => void;
  private observedPanelTarget: PanelTargetLease;
  private observedDraft: string;

  constructor(private readonly options: ChatComposerControllerOptions) {
    this.attachmentTransfers = new ComposerAttachmentTransfers({
      attachmentHandler: options.attachmentHandler,
      stateStore: options.stateStore,
      composerElement: () => this.composer,
      setPendingSelection: (selection) => {
        this.pendingSelection = selection;
      },
      onDraftReplaced: (draft) => {
        this.pruneActiveNoteContextSnapshots(draft);
        this.pruneSelectionContextSnapshots(draft);
      },
      onError: options.onAttachmentError,
    });
    const state = options.stateStore.getState();
    this.observedPanelTarget = capturePanelTargetLease(state);
    this.observedDraft = state.composer.draft;
    this.unsubscribeState = options.stateStore.subscribe(() => {
      this.reconcilePanelTarget();
    });
    this.unsubscribeSharedResources = options.sharedResources.subscribe(() => {
      if (this.composer) this.updateSuggestions();
    });
  }

  private get state(): ChatState {
    return this.options.stateStore.getState();
  }

  private dispatch(action: ChatAction): void {
    this.options.stateStore.dispatch(action);
  }

  get draft(): string {
    return this.composer?.value ?? this.state.composer.draft;
  }

  get trimmedDraft(): string {
    return this.draft.trim();
  }

  renderState(model: ChatPanelComposerModel, actions: ChatComposerRenderActions): ComposerShellProps {
    const projection = projectChatPanelComposer(model, this.options.runtimeActions);
    return {
      viewId: this.options.viewId,
      draft: model.draft,
      busy: model.turnBusy,
      canInterrupt: composerCanInterrupt(model),
      submissionDisabled: model.webSubmissionPending,
      directInputDisabled: model.submissionBlockedByPanelPolicy,
      runtimeControlsDisabled: model.runtimeSettingsDisabled,
      sendDisabled: model.attachmentSavePending,
      webSubmissionCancellable: model.webSubmissionCancellable,
      normalPlaceholder: projection.placeholder,
      suggestions: model.suggestions,
      selectedSuggestionIndex: model.selectedSuggestionIndex,
      pendingSelection: this.pendingSelection,
      onPendingSelectionApplied: this.clearPendingSelection,
      callbacks: this.composerCallbacks(actions, model),
      meta: projection.meta,
      onComposer: this.setComposerElement,
    };
  }

  private readonly setComposerElement = (composer: HTMLTextAreaElement | null): void => {
    if (!composer) {
      this.composer = null;
      return;
    }
    this.composer = composer;
    syncComposerHeight(composer);
  };

  setDraft(
    text: string,
    options: {
      focus?: boolean;
      clearSuggestions?: boolean;
      preserveContext?: boolean;
      threadCommandTarget?: ThreadCommandTarget | null;
    } = {},
  ): void {
    if ("threadCommandTarget" in options) this.threadCommandTarget = options.threadCommandTarget ?? null;
    this.pruneThreadCommandTarget(text);
    if (!options.preserveContext) {
      this.pruneActiveNoteContextSnapshots(text);
      this.pruneSelectionContextSnapshots(text);
      this.attachmentTransfers.prune(text);
    }
    this.dispatch({
      type: "composer/draft-set",
      draft: text,
      ...(options.clearSuggestions === undefined ? {} : { clearSuggestions: options.clearSuggestions }),
    });
    if (options.focus && this.options.canFocus()) focusComposer(this.composer);
  }

  focusComposer(options: { force?: boolean } = {}): void {
    if (options.force !== true && !this.options.canFocus()) return;
    focusComposer(this.composer, { preventScroll: true });
  }

  hasFocus(): boolean {
    return composerHasFocus(this.composer);
  }

  dispose(): void {
    this.activeSubmissionClaim?.claim.settle("accepted");
    this.unsubscribeState();
    this.unsubscribeSharedResources();
    this.attachmentTransfers.dispose();
    this.threadCommandTarget = null;
    this.composer = null;
    this.options.noteCandidateProvider.dispose();
    this.options.contextReferenceProvider.dispose();
  }

  captureInputSnapshot(): ComposerInputSnapshot {
    const sourcePath = this.options.sourcePath();
    const threadCommandTarget = threadCommandTargetForDraft(this.draft, this.threadCommandTarget);
    return {
      sourcePath,
      availableSkills: this.options.sharedResources.skillsSnapshot() ?? [],
      referenceActiveNoteOnSend: this.options.referenceActiveNoteOnSend(),
      contextReferences: this.options.contextReferenceProvider.contextReferences(sourcePath),
      activeNoteSnapshots: [...this.activeNoteContextSnapshots],
      selectionSnapshots: [...this.selectionContextSnapshots],
      attachments: this.attachmentTransfers.snapshot(),
      ...(threadCommandTarget ? { threadCommandTarget } : {}),
    };
  }

  claimSubmission(): ComposerSubmissionClaim | null {
    if (this.activeSubmissionClaim) return null;
    const text = this.draft;
    if (!text.trim()) return null;
    const inputSnapshot = this.captureInputSnapshot();
    const panelTarget = capturePanelTargetLease(this.state);
    let settled = false;

    this.attachmentTransfers.clear();
    this.activeNoteContextSnapshots = [];
    this.selectionContextSnapshots = [];
    this.threadCommandTarget = null;
    this.setDraft("", { clearSuggestions: true, preserveContext: true, threadCommandTarget: null });

    const claim: ComposerSubmissionClaim = {
      text,
      inputSnapshot,
      isCurrent: () => {
        const activeClaim = this.activeSubmissionClaim;
        return !settled && activeClaim?.claim === claim && panelTargetLeaseIsCurrent(this.state, activeClaim.panelTarget);
      },
      markAdopted: () => {
        if (settled || this.activeSubmissionClaim?.claim !== claim) return;
        this.activeSubmissionClaim.phase = "adopted";
      },
      adoptPanelTarget: (targetThreadId, replacementDraft) => {
        if (settled || this.activeSubmissionClaim?.claim !== claim) return;
        this.activeSubmissionClaim.phase = "adopted";
        this.activeSubmissionClaim.targetAdoption =
          replacementDraft === undefined ? { targetThreadId } : { targetThreadId, replacementDraft };
      },
      settle: (outcome, replacementDraft) => {
        if (settled) return;
        settled = true;
        const activeClaim = this.activeSubmissionClaim;
        if (activeClaim?.claim === claim) this.activeSubmissionClaim = null;
        if (activeClaim?.claim !== claim || !panelTargetLeaseIsCurrent(this.state, activeClaim.panelTarget)) {
          return;
        }

        const nextDraft = this.draft;
        if (outcome === "accepted") {
          if (replacementDraft === undefined) return;
          const restoredDraft = nextDraft.trim().length > 0 ? `${replacementDraft}\n\n${nextDraft}` : replacementDraft;
          this.setDraft(restoredDraft, {
            focus: true,
            clearSuggestions: true,
            preserveContext: true,
          });
          return;
        }

        const restoredDraft = nextDraft.trim().length > 0 ? `${text}\n\n${nextDraft}` : text;
        this.attachmentTransfers.restoreClaimed(inputSnapshot.attachments);
        this.activeNoteContextSnapshots = mergeByMarker(
          inputSnapshot.activeNoteSnapshots,
          this.activeNoteContextSnapshots,
          activeNoteContextReferenceMarker,
        );
        this.selectionContextSnapshots = mergeByMarker(
          inputSnapshot.selectionSnapshots,
          this.selectionContextSnapshots,
          selectionContextReferenceMarker,
        );
        this.setDraft(restoredDraft, {
          focus: true,
          clearSuggestions: true,
          preserveContext: true,
          threadCommandTarget: inputSnapshot.threadCommandTarget ?? this.threadCommandTarget,
        });
      },
    };
    this.activeSubmissionClaim = {
      claim,
      panelTarget,
      phase: "preflight",
      targetAdoption: null,
    };
    return claim;
  }

  isSubmissionPreparing(): boolean {
    return this.activeSubmissionClaim !== null;
  }

  failActiveSubmissionClaim(): void {
    this.activeSubmissionClaim?.claim.settle("failed");
  }

  runtimeSnapshot(): ComposerRuntimeSnapshot {
    const activeClaim = this.activeSubmissionClaim;
    activeClaim?.claim.settle(activeClaim.phase === "adopted" ? "accepted" : "failed");
    return {
      draft: this.state.composer.draft,
      attachments: this.attachmentTransfers.snapshot(),
      activeNoteSnapshots: [...this.activeNoteContextSnapshots],
      selectionSnapshots: [...this.selectionContextSnapshots],
      threadCommandTarget: this.threadCommandTarget,
    };
  }

  restoreRuntimeSnapshot(snapshot: ComposerRuntimeSnapshot): void {
    this.attachmentTransfers.restore(snapshot.attachments);
    this.activeNoteContextSnapshots = [...snapshot.activeNoteSnapshots];
    this.selectionContextSnapshots = [...snapshot.selectionSnapshots];
    this.threadCommandTarget = snapshot.threadCommandTarget;
    this.setDraft(snapshot.draft, {
      preserveContext: true,
      threadCommandTarget: snapshot.threadCommandTarget,
    });
  }

  preparedInput(text: string, snapshot: ComposerInputSnapshot = this.captureInputSnapshot()): PreparedComposerInput {
    const prepared = preparedUserInputWithWikiLinkReferencesSkillsAndContext(
      text,
      (target) => this.options.noteCandidateProvider.resolveFileReference(target, snapshot.sourcePath),
      snapshot.availableSkills,
      this.contextReferencesFromSnapshot(snapshot, text),
      { referenceActiveNoteOnSend: snapshot.referenceActiveNoteOnSend },
    );
    return {
      text: prepared.text,
      input: codexInputWithComposerAttachments(prepared.text, prepared.input, snapshot.attachments),
    };
  }

  private handleSuggestionKeydown(event: KeyboardEvent): boolean {
    if (event.isComposing) return false;
    const state = this.state;
    if (state.composer.suggestions.length === 0) return false;

    const direction = composerSuggestionNavigationDirection(event);
    if (direction) {
      event.preventDefault();
      this.dispatch({
        type: "composer/suggestions-set",
        suggestions: state.composer.suggestions,
        selected: nextComposerSuggestionIndex(state.composer.suggestSelected, state.composer.suggestions.length, direction),
      });
      return true;
    }
    if (event.metaKey || event.ctrlKey) return false;

    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      this.insertSuggestion(state.composer.suggestions[state.composer.suggestSelected], event.key === "Tab" ? "tab" : "enter");
      return true;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      this.dismissSuggestions();
      return true;
    }

    return false;
  }

  private reconcilePanelTarget(): void {
    const state = this.state;
    const panelTarget = capturePanelTargetLease(state);
    if (panelTargetLeasesMatch(panelTarget, this.observedPanelTarget)) {
      this.observedDraft = state.composer.draft;
      return;
    }

    const activeClaim = this.activeSubmissionClaim;
    const carriedDraft = this.observedDraft;
    this.observedPanelTarget = panelTarget;
    this.observedDraft = state.composer.draft;

    if (activeClaim?.targetAdoption?.targetThreadId === panelThreadId(state)) {
      activeClaim.panelTarget = panelTarget;
      const { replacementDraft } = activeClaim.targetAdoption;
      activeClaim.targetAdoption = null;
      const adoptedDraft =
        replacementDraft === undefined || carriedDraft.trim().length === 0
          ? (replacementDraft ?? carriedDraft)
          : `${replacementDraft}\n\n${carriedDraft}`;
      this.setDraft(adoptedDraft, {
        preserveContext: true,
        threadCommandTarget: this.threadCommandTarget,
      });
      return;
    }

    activeClaim?.claim.settle("failed");
    this.attachmentTransfers.clear();
    this.activeNoteContextSnapshots = [];
    this.selectionContextSnapshots = [];
    this.threadCommandTarget = null;
  }

  private handleBoundaryScrollKeydown(event: KeyboardEvent): boolean {
    const action = composerBoundaryScrollActionFromElement(event, this.composer);
    if (!action) return false;
    if (action.kind === "scroll-by" && action.amount === "text-lines" && !this.options.scrollThreadFromComposerEdges()) return false;

    event.preventDefault();
    this.options.threadScrollFromComposer(action);
    return true;
  }

  private updateSuggestions(): void {
    const beforeCursor = composerTextBeforeCursor(this.composer);
    if (beforeCursor === null) {
      this.clearSuggestions();
      return;
    }

    const signature = this.suggestionSignature();
    const state = this.state;
    if (state.composer.suggestionsDismissedSignature === signature) {
      this.dispatch({ type: "composer/suggestions-set", suggestions: [] });
      return;
    }
    const suggestions = this.activeSuggestions(beforeCursor, state);

    this.dispatch({
      type: "composer/suggestions-set",
      suggestions,
      selected: state.composer.suggestSelected >= suggestions.length ? 0 : state.composer.suggestSelected,
    });
  }

  private handleInput(value: string): void {
    this.pruneThreadCommandTarget(value);
    this.pruneActiveNoteContextSnapshots(value);
    this.pruneSelectionContextSnapshots(value);
    this.attachmentTransfers.prune(value);
    const suggestionState = this.inputSuggestionState();
    this.dispatch({
      type: "composer/input-set",
      draft: value,
      suggestions: suggestionState.suggestions,
      selected: suggestionState.selected,
      dismissedSignature: suggestionState.dismissedSignature,
    });
  }

  private inputSuggestionState(): {
    suggestions: readonly ComposerSuggestion[];
    selected: number;
    dismissedSignature: string | null;
  } {
    if (!this.composer) return { suggestions: [], selected: 0, dismissedSignature: null };
    const signature = this.suggestionSignature();
    const state = this.state;
    if (state.composer.suggestionsDismissedSignature === signature) {
      return { suggestions: [], selected: 0, dismissedSignature: signature };
    }
    const beforeCursor = composerTextBeforeCursor(this.composer);
    if (beforeCursor === null) return { suggestions: [], selected: 0, dismissedSignature: null };
    const suggestions = this.activeSuggestions(beforeCursor, state);
    return {
      suggestions,
      selected: state.composer.suggestSelected >= suggestions.length ? 0 : state.composer.suggestSelected,
      dismissedSignature: null,
    };
  }

  private activeSuggestions(beforeCursor: string, state: ChatState): readonly ComposerSuggestion[] {
    return activeComposerSuggestions(
      beforeCursor,
      this.noteCandidates(),
      this.options.sharedResources.skillsSnapshot() ?? [],
      this.options.sharedResources.activeThreadsSnapshot() ?? [],
      this.options.sharedResources.modelsSnapshot() ?? [],
      this.currentModelForSuggestions(),
      {
        activeThreadId: activeThreadState(state)?.id ?? null,
        slashCommandAvailable: (command) => {
          if (activePanelOperationDecision(state, "submit").kind === "blocked") return false;
          if (command === "fast") {
            const snapshot = runtimeSnapshotForChatState(state, this.options.sharedResources);
            const config = runtimeConfigOrDefault(this.options.sharedResources.runtimeConfigSnapshot());
            if (!resolveRuntimeControls(snapshot, config).fastMode.available) return false;
          }
          const operation = activePanelOperationForSlashCommandSuggestion(command);
          return !operation || activePanelOperationDecision(state, operation).kind === "allowed";
        },
        contextReferences: this.contextReferences(),
        dailyNoteReferences: () => this.options.noteCandidateProvider.dailyNoteReferences(this.options.sourcePath()),
        permissionProfiles: this.options.sharedResources.permissionProfilesSnapshot() ?? [],
        tagCandidates: () => this.options.noteCandidateProvider.tags(),
        fuzzyMatcher: this.options.fuzzyMatcher,
      },
    );
  }

  private selectSuggestion(index: number): void {
    if (this.state.composer.suggestSelected === index) return;
    this.dispatch({ type: "composer/suggestions-set", suggestions: this.state.composer.suggestions, selected: index });
  }

  private insertSuggestion(suggestion: ComposerSuggestion | undefined, activation: "enter" | "tab" = "enter"): void {
    if (!suggestion) return;
    const source = composerInsertionSource(this.composer);
    if (!source) return;

    const insertion = applyComposerSuggestionInsertion(source.value, source.cursor, suggestion, { activation });
    this.threadCommandTarget = suggestion.threadCommandTarget ?? threadCommandTargetForDraft(insertion.value, this.threadCommandTarget);
    if (suggestion.activeNoteContext) this.rememberActiveNoteContextSnapshot(suggestion.activeNoteContext);
    if (suggestion.selectionContext) this.rememberSelectionContextSnapshot(suggestion.selectionContext);
    this.pruneActiveNoteContextSnapshots(insertion.value);
    this.pruneSelectionContextSnapshots(insertion.value);

    this.pendingSelection = collapsedComposerSelection(insertion.value, insertion.cursor);
    this.dispatch({ type: "composer/draft-set", draft: insertion.value, clearSuggestions: true });
    applyComposerInsertionToElement(this.composer, insertion.cursor);
  }

  private readonly clearPendingSelection = (): void => {
    this.pendingSelection = null;
  };

  private clearSuggestions(): void {
    this.dispatch({ type: "composer/suggestions-set", suggestions: [], selected: 0 });
  }

  private dismissSuggestions(): void {
    this.dispatch({
      type: "composer/suggestions-set",
      suggestions: [],
      selected: 0,
      dismissedSignature: this.suggestionSignature(),
    });
  }

  private suggestionSignature(): string | null {
    return composerSuggestionSignatureFromElement(this.composer);
  }

  private noteCandidates(): NoteCandidate[] {
    return [...this.options.noteCandidateProvider.candidates(this.options.sourcePath())];
  }

  private currentModelForSuggestions(): string | null {
    const state = this.state;
    const config = runtimeConfigOrDefault(this.options.sharedResources.runtimeConfigSnapshot());
    return resolveRuntimeControls(runtimeSnapshotForChatState(state, this.options.sharedResources), config).model.effective;
  }

  private contextReferences(text: string | null = null) {
    return this.contextReferencesFromSnapshot(this.captureInputSnapshot(), text);
  }

  private contextReferencesFromSnapshot(snapshot: ComposerInputSnapshot, text: string | null = null) {
    const availableActiveNoteSnapshots = snapshot.activeNoteSnapshots;
    const availableSelectionSnapshots = snapshot.selectionSnapshots;
    const activeNoteSnapshots =
      text === null
        ? availableActiveNoteSnapshots
        : availableActiveNoteSnapshots.filter((activeNote) => text.includes(activeNoteContextReferenceMarker(activeNote)));
    const selectionSnapshots =
      text === null
        ? availableSelectionSnapshots
        : availableSelectionSnapshots.filter((selection) => text.includes(selectionContextReferenceMarker(selection)));
    return { ...snapshot.contextReferences, activeNoteSnapshots, selectionSnapshots };
  }

  private rememberActiveNoteContextSnapshot(activeNote: ActiveNoteContextReference): void {
    const marker = activeNoteContextReferenceMarker(activeNote);
    this.activeNoteContextSnapshots = [
      ...this.activeNoteContextSnapshots.filter((snapshot) => activeNoteContextReferenceMarker(snapshot) !== marker),
      activeNote,
    ];
  }

  private rememberSelectionContextSnapshot(selection: SelectionContextReference): void {
    const marker = selectionContextReferenceMarker(selection);
    this.selectionContextSnapshots = [
      ...this.selectionContextSnapshots.filter((snapshot) => selectionContextReferenceMarker(snapshot) !== marker),
      selection,
    ];
  }

  private pruneSelectionContextSnapshots(text: string): void {
    this.selectionContextSnapshots = this.selectionContextSnapshots.filter((selection) =>
      text.includes(selectionContextReferenceMarker(selection)),
    );
  }

  private pruneActiveNoteContextSnapshots(text: string): void {
    this.activeNoteContextSnapshots = this.activeNoteContextSnapshots.filter((activeNote) =>
      text.includes(activeNoteContextReferenceMarker(activeNote)),
    );
  }

  private pruneThreadCommandTarget(text: string): void {
    this.threadCommandTarget = threadCommandTargetForDraft(text, this.threadCommandTarget);
  }

  private attachmentSaveBlocksSubmit(model: ChatPanelComposerModel): boolean {
    return this.attachmentTransfers.blocksSubmission(composerCanInterrupt(model));
  }

  private composerCallbacks(actions: ChatComposerRenderActions, model: ChatPanelComposerModel): ComposerCallbacks {
    return {
      onInput: (value) => {
        this.handleInput(value);
      },
      onUpdateSuggestions: () => {
        this.updateSuggestions();
      },
      onKeydown: (event) => {
        if (this.handleSuggestionKeydown(event)) {
          return;
        }
        if (this.handleBoundaryScrollKeydown(event)) {
          return;
        }
        if (isComposerSendKey(event, this.options.sendShortcut())) {
          event.preventDefault();
          if (!this.attachmentSaveBlocksSubmit(model)) actions.submit();
        }
      },
      onPaste: (event) => {
        const files = composerFilesFromTransfer(event.clipboardData);
        if (files.length === 0) return;
        event.preventDefault();
        this.attachmentTransfers.transfer(files);
      },
      onDrop: (event) => {
        const files = composerFilesFromTransfer(event.dataTransfer);
        if (files.length === 0) return;
        event.preventDefault();
        this.attachmentTransfers.transfer(files);
      },
      onDragOver: (event) => {
        if (!composerTransferHasFiles(event.dataTransfer)) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      },
      onSendOrInterrupt: () => {
        if (this.state.pendingSubmission?.phase === "cancellable") {
          actions.submit();
          return;
        }
        if (this.state.pendingSubmission || this.attachmentSaveBlocksSubmit(model)) return;
        actions.submit();
      },
      onTogglePlan: () => {
        this.options.togglePlan();
      },
      onToggleAutoReview: () => {
        this.options.toggleAutoReview();
      },
      onToggleFast: () => {
        this.options.toggleFast();
      },
      onSuggestionHover: (index) => {
        this.selectSuggestion(index);
      },
      onSuggestionInsert: (suggestion) => {
        this.insertSuggestion(suggestion);
      },
    };
  }
}

function mergeByMarker<T>(claimed: readonly T[], current: readonly T[], marker: (value: T) => string): T[] {
  const merged = new Map<string, T>();
  for (const value of claimed) merged.set(marker(value), value);
  for (const value of current) merged.set(marker(value), value);
  return [...merged.values()];
}

function collapsedComposerSelection(value: string, cursor: number): ComposerPendingSelection {
  return { value, start: cursor, end: cursor, direction: "none" };
}
