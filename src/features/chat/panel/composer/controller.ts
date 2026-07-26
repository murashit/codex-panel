import type { SkillMetadata } from "../../../../domain/catalog/metadata";
import { isComposerSendKey, type SendShortcut } from "../../../../domain/input/send-shortcut";
import { runtimeConfigOrDefault } from "../../../../domain/runtime/config";
import type { RuntimePermissionProfileSummary } from "../../../../domain/runtime/permissions";
import type { Thread } from "../../../../domain/threads/model";
import { OwnerLifetime } from "../../../../shared/runtime/owner-lifetime";
import {
  type ComposerAttachment,
  type ComposerAttachmentHandler,
  codexInputWithComposerAttachments,
} from "../../application/composer/attachments";
import type { ComposerBoundaryScrollAction } from "../../application/composer/boundary-scroll";
import {
  type ActiveNoteContextReference,
  activeNoteContextReferenceMarker,
  type ComposerContextReferenceProvider,
  type SelectionContextReference,
  selectionContextReferenceMarker,
} from "../../application/composer/context-references";
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
import {
  applyComposerInsertionToElement,
  type ComposerElementSelection,
  composerBoundaryScrollActionFromElement,
  composerFilesFromTransfer,
  composerHasFocus,
  composerInsertionSource,
  composerRangeInsertionSource,
  composerSelectionSource,
  composerSuggestionSignatureFromElement,
  composerTextBeforeCursor,
  composerTransferHasFiles,
  focusComposer,
} from "./element.dom";
import { type ChatPanelComposerRuntimeActions, projectChatPanelComposer } from "./view-projection";

interface ChatComposerControllerOptions {
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
  targetAdoption: { replacementDraft?: string } | null;
}

function composerCanInterrupt(model: ChatPanelComposerModel): boolean {
  return model.turnBusy && Boolean(model.activeThreadId && model.activeTurnId);
}

export class ChatComposerController {
  private readonly lifetime = new OwnerLifetime();
  private composer: HTMLTextAreaElement | null = null;
  private attachments: ComposerAttachment[] = [];
  private pendingAttachmentSaveId = 0;
  private pendingAttachmentSaves = new Map<number, PendingAttachmentSave>();
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
      this.pruneAttachments(text);
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
    this.lifetime.dispose();
    for (const pending of this.pendingAttachmentSaves.values()) this.settlePendingAttachmentSave(pending);
    this.pendingAttachmentSaves.clear();
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
      attachments: [...this.attachments],
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

    this.attachments = [];
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
      adoptPanelTarget: (replacementDraft) => {
        if (settled || this.activeSubmissionClaim?.claim !== claim) return;
        this.activeSubmissionClaim.phase = "adopted";
        this.activeSubmissionClaim.targetAdoption = replacementDraft === undefined ? {} : { replacementDraft };
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
        this.attachments = mergeByMarker(inputSnapshot.attachments, this.attachments, (attachment) => attachment.marker);
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
      attachments: [...this.attachments],
      activeNoteSnapshots: [...this.activeNoteContextSnapshots],
      selectionSnapshots: [...this.selectionContextSnapshots],
      threadCommandTarget: this.threadCommandTarget,
    };
  }

  restoreRuntimeSnapshot(snapshot: ComposerRuntimeSnapshot): void {
    this.attachments = [...snapshot.attachments];
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

    if (activeClaim?.targetAdoption) {
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
    this.attachments = [];
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
    this.pruneAttachments(value);
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
          const operation = activePanelOperationForSlashCommandSuggestion(command);
          return !operation || activePanelOperationDecision(state, operation).kind === "allowed";
        },
        contextReferences: this.contextReferences(),
        dailyNoteReferences: () => this.options.noteCandidateProvider.dailyNoteReferences(this.options.sourcePath()),
        permissionProfiles: this.options.sharedResources.permissionProfilesSnapshot() ?? [],
        tagCandidates: () => this.options.noteCandidateProvider.tags(),
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

  private handleTransferredFiles(files: readonly File[]): void {
    if (files.length === 0) return;
    const handler = this.options.attachmentHandler;

    const pending = this.startPendingAttachmentSave(files);
    this.pendingAttachmentSaves.set(pending.id, pending);
    void this.saveTransferredFiles(handler, files, pending).finally(() => {
      this.pendingAttachmentSaves.delete(pending.id);
    });
  }

  private async saveTransferredFiles(
    handler: ComposerAttachmentHandler,
    files: readonly File[],
    pending: PendingAttachmentSave,
  ): Promise<void> {
    const lifetime = this.lifetime.signal();
    if (!this.lifetime.isCurrent(lifetime)) return;
    try {
      const attachments = await handler.saveFiles(files);
      if (!this.lifetime.isCurrent(lifetime)) return;
      this.completePendingAttachmentSave(pending, attachments);
    } catch (error) {
      if (!this.lifetime.isCurrent(lifetime)) return;
      this.settlePendingAttachmentSave(pending);
      this.options.onAttachmentError(error instanceof Error ? error.message : String(error));
    }
  }

  private startPendingAttachmentSave(files: readonly File[]): PendingAttachmentSave {
    const id = ++this.pendingAttachmentSaveId;
    const draft = this.state.composer.draft;
    const source = composerRangeInsertionSource(this.composer);
    const selection = source && source.value === draft ? source : null;
    const placeholder = pendingAttachmentPlaceholder(id, files.length);
    const insertion = applyAttachmentMarkerInsertion(draft, selection?.start ?? draft.length, selection?.end ?? draft.length, [
      placeholder,
    ]);
    const placeholderOffset = insertion.insertedText.indexOf(placeholder);
    const pending = {
      id,
      destination: pendingAttachmentDestination(id),
      displacedText: selection ? draft.slice(selection.start, selection.end) : "",
      syntheticPrefix: insertion.insertedText.slice(0, placeholderOffset),
      syntheticSuffix: insertion.insertedText.slice(placeholderOffset + placeholder.length),
      panelTargetRevision: this.state.panelTargetRevision,
      threadId: panelThreadId(this.state),
    };
    this.pendingSelection = collapsedComposerSelection(insertion.value, insertion.cursor);
    this.dispatch({ type: "composer/attachment-save-started", saveId: id, draft: insertion.value });
    applyComposerInsertionToElement(this.composer, insertion.cursor);
    return pending;
  }

  private completePendingAttachmentSave(pending: PendingAttachmentSave, attachments: readonly ComposerAttachment[]): void {
    const markers = attachments.map((attachment) => attachment.marker);
    const state = this.state;
    if (
      state.panelTargetRevision !== pending.panelTargetRevision ||
      panelThreadId(state) !== pending.threadId ||
      !state.composer.pendingAttachmentSaveIds.includes(pending.id)
    ) {
      this.settlePendingAttachmentSave(pending);
      return;
    }

    const replacement =
      markers.length === 0
        ? replacePendingAttachmentWithOriginalText(state.composer.draft, pending)
        : replacePendingAttachmentPlaceholder(state.composer.draft, pending, markers);
    this.pendingSelection = adjustedComposerSelection(composerSelectionSource(this.composer), state.composer.draft, replacement);
    this.attachments = [...this.attachments, ...attachments];
    this.pruneAttachments(replacement.value);
    this.pruneActiveNoteContextSnapshots(replacement.value);
    this.pruneSelectionContextSnapshots(replacement.value);
    this.dispatch({ type: "composer/attachment-save-settled", saveId: pending.id, draft: replacement.value });
  }

  private settlePendingAttachmentSave(pending: PendingAttachmentSave): void {
    const state = this.state;
    if (!state.composer.pendingAttachmentSaveIds.includes(pending.id)) return;
    const replacement = replacePendingAttachmentWithOriginalText(state.composer.draft, pending);
    this.pendingSelection = adjustedComposerSelection(composerSelectionSource(this.composer), state.composer.draft, replacement);
    this.dispatch({ type: "composer/attachment-save-settled", saveId: pending.id, draft: replacement.value });
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

  private activeAttachments(text: string): readonly ComposerAttachment[] {
    return this.attachments
      .filter((attachment) => text.includes(attachment.marker))
      .sort((left, right) => text.indexOf(left.marker) - text.indexOf(right.marker));
  }

  private pruneAttachments(text: string): void {
    this.attachments = [...this.activeAttachments(text)];
  }

  private attachmentSaveBlocksSubmit(model: ChatPanelComposerModel): boolean {
    if (this.state.composer.pendingAttachmentSaveIds.length === 0) return false;
    const canInterrupt = composerCanInterrupt(model);
    return !(canInterrupt && this.state.composer.draft.trim().length === 0);
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
        this.handleTransferredFiles(files);
      },
      onDrop: (event) => {
        const files = composerFilesFromTransfer(event.dataTransfer);
        if (files.length === 0) return;
        event.preventDefault();
        this.handleTransferredFiles(files);
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

interface PendingAttachmentSave {
  readonly id: number;
  readonly destination: string;
  readonly displacedText: string;
  readonly syntheticPrefix: string;
  readonly syntheticSuffix: string;
  readonly panelTargetRevision: number;
  readonly threadId: string | null;
}

interface DraftReplacement {
  readonly value: string;
  readonly start: number;
  readonly end: number;
  readonly replacementLength: number;
}

function pendingAttachmentPlaceholder(id: number, fileCount: number): string {
  const label = fileCount === 1 ? "Saving attachment…" : `Saving ${String(fileCount)} attachments…`;
  return `[${label}](${pendingAttachmentDestination(id)})`;
}

function pendingAttachmentDestination(id: number): string {
  return `codex-panel-pending-attachment:${String(id)}`;
}

function replacePendingAttachmentPlaceholder(draft: string, pending: PendingAttachmentSave, markers: readonly string[]): DraftReplacement {
  const range = pendingAttachmentLinkRange(draft, pending.destination);
  return range ? replaceDraftRange(draft, range.start, range.end, markers.join("\n")) : unchangedDraftReplacement(draft);
}

function replacePendingAttachmentWithOriginalText(draft: string, pending: PendingAttachmentSave): DraftReplacement {
  const range = pendingAttachmentLinkRange(draft, pending.destination);
  if (!range) return unchangedDraftReplacement(draft);
  const prefixStart = range.start - pending.syntheticPrefix.length;
  const start = prefixStart >= 0 && draft.slice(prefixStart, range.start) === pending.syntheticPrefix ? prefixStart : range.start;
  const suffixEnd = range.end + pending.syntheticSuffix.length;
  const end = draft.slice(range.end, suffixEnd) === pending.syntheticSuffix ? suffixEnd : range.end;
  return replaceDraftRange(draft, start, end, pending.displacedText);
}

function adjustedComposerSelection(
  selection: ComposerElementSelection | null,
  draft: string,
  replacement: DraftReplacement,
): ComposerPendingSelection | null {
  if (!selection || selection.value !== draft || replacement.value === draft) return null;
  const adjust = (position: number): number => {
    if (position <= replacement.start) return position;
    if (position >= replacement.end) return position + replacement.replacementLength - (replacement.end - replacement.start);
    return replacement.start + replacement.replacementLength;
  };
  return {
    value: replacement.value,
    start: adjust(selection.start),
    end: adjust(selection.end),
    direction: selection.direction,
  };
}

function applyAttachmentMarkerInsertion(
  value: string,
  start: number,
  end: number,
  markers: readonly string[],
): { value: string; cursor: number; insertedText: string } {
  const prefix = value.slice(0, start);
  const suffix = value.slice(end);
  const before = prefix && !prefix.endsWith("\n") ? "\n" : "";
  const after = suffix && !suffix.startsWith("\n") ? "\n" : "";
  const inserted = markers.join("\n");
  const nextValue = `${prefix}${before}${inserted}${after}${suffix}`;
  return {
    value: nextValue,
    cursor: prefix.length + before.length + inserted.length,
    insertedText: `${before}${inserted}${after}`,
  };
}

function pendingAttachmentLinkRange(draft: string, destination: string): { start: number; end: number } | null {
  const suffix = `](${destination})`;
  const suffixStart = draft.indexOf(suffix);
  if (suffixStart < 0) return null;
  const start = draft.lastIndexOf("[", suffixStart);
  return start < 0 ? null : { start, end: suffixStart + suffix.length };
}

function replaceDraftRange(draft: string, start: number, end: number, replacement: string): DraftReplacement {
  return {
    value: `${draft.slice(0, start)}${replacement}${draft.slice(end)}`,
    start,
    end,
    replacementLength: replacement.length,
  };
}

function unchangedDraftReplacement(draft: string): DraftReplacement {
  return { value: draft, start: draft.length, end: draft.length, replacementLength: 0 };
}
