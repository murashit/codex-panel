import { isComposerSendKey, type SendShortcut } from "../../../domain/input/send-shortcut";
import { OwnerLifetime } from "../../../shared/runtime/owner-lifetime";
import {
  type ComposerAttachment,
  type ComposerAttachmentHandler,
  codexInputWithComposerAttachments,
} from "../application/composer/attachments";
import type { ComposerBoundaryScrollAction } from "../application/composer/boundary-scroll";
import {
  type ActiveNoteContextReference,
  activeNoteContextReferenceMarker,
  type ComposerContextReferenceProvider,
  type SelectionContextReference,
  selectionContextReferenceMarker,
} from "../application/composer/context-references";
import type { ComposerInputSnapshot } from "../application/composer/input-snapshot";
import type { NoteCandidateProvider } from "../application/composer/note-context";
import {
  activeComposerSuggestions,
  applyComposerSuggestionInsertion,
  type ComposerSuggestion,
  composerSuggestionNavigationDirection,
  type NoteCandidate,
  nextComposerSuggestionIndex,
} from "../application/composer/suggestions";
import {
  type PreparedComposerInput,
  preparedUserInputWithWikiLinkMentionsSkillsAndContext,
} from "../application/composer/wikilink-context";
import { activeThreadState, type ChatAction, type ChatState } from "../application/state/root-reducer";
import type { ChatStateStore } from "../application/state/store";
import type { ComposerCallbacks, ComposerPendingSelection, ComposerShellProps } from "../ui/composer";
import { syncComposerHeight } from "../ui/composer.dom";
import {
  applyComposerInsertionToElement,
  composerBoundaryScrollActionFromElement,
  composerFilesFromTransfer,
  composerHasFocus,
  composerInsertionSource,
  composerRangeInsertionSource,
  composerSuggestionSignatureFromElement,
  composerTextBeforeCursor,
  composerTransferHasFiles,
  focusComposer,
} from "./composer-element.dom";
import type { ChatPanelComposerModel } from "./shell-selectors";
import type { ChatPanelComposerProjection } from "./surface/composer-projection";

export interface ChatComposerControllerOptions {
  noteCandidateProvider: NoteCandidateProvider;
  contextReferenceProvider: ComposerContextReferenceProvider;
  attachmentHandler?: ComposerAttachmentHandler;
  sourcePath: () => string;
  stateStore: ChatStateStore;
  viewId: string;
  referenceActiveNoteOnSend: () => boolean;
  sendShortcut: () => SendShortcut;
  scrollThreadFromComposerEdges: () => boolean;
  canInterrupt: (model: ChatPanelComposerModel) => boolean;
  composerProjection: (model: ChatPanelComposerModel) => ChatPanelComposerProjection;
  currentModelForSuggestions: () => string | null;
  threadScrollFromComposer: (action: ComposerBoundaryScrollAction) => void;
  togglePlan: () => void;
  toggleAutoReview: () => void;
  toggleFast: () => void;
  onDraftChange: () => void;
  onHeightChange: () => void;
  onAttachmentError?: (message: string) => void;
}

export interface ChatComposerRenderActions {
  submit: () => void;
}

export class ChatComposerController {
  private readonly lifetime = new OwnerLifetime();
  private composer: HTMLTextAreaElement | null = null;
  private attachments: ComposerAttachment[] = [];
  private pendingAttachmentTransfers = new Set<Promise<void>>();
  private submitAfterAttachmentTransfersActive = false;
  private activeNoteContextSnapshots: ActiveNoteContextReference[] = [];
  private selectionContextSnapshots: SelectionContextReference[] = [];
  private pendingSelection: ComposerPendingSelection | null = null;

  constructor(private readonly options: ChatComposerControllerOptions) {}

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
    const projection = this.options.composerProjection(model);
    return {
      viewId: this.options.viewId,
      draft: model.draft,
      busy: model.turnBusy,
      canInterrupt: this.options.canInterrupt(model),
      submissionDisabled: model.activeThreadSubagent || model.webSubmissionPending,
      webSubmissionCancellable: model.webSubmissionCancellable,
      normalPlaceholder: projection.placeholder,
      suggestions: model.suggestions,
      selectedSuggestionIndex: model.selectedSuggestionIndex,
      pendingSelection: this.pendingSelection,
      onPendingSelectionApplied: this.clearPendingSelection,
      callbacks: this.composerCallbacks(actions),
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

  setDraft(text: string, options: { focus?: boolean; clearSuggestions?: boolean; preserveContext?: boolean } = {}): void {
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
    this.options.onDraftChange();
    if (options.focus) focusComposer(this.composer);
  }

  focusComposer(): void {
    focusComposer(this.composer, { preventScroll: true });
  }

  hasFocus(): boolean {
    return composerHasFocus(this.composer);
  }

  dispose(): void {
    this.lifetime.dispose();
    this.composer = null;
    this.options.noteCandidateProvider.dispose();
    this.options.contextReferenceProvider.dispose();
  }

  refreshSuggestions(): void {
    this.updateSuggestions();
  }

  captureInputSnapshot(): ComposerInputSnapshot {
    const sourcePath = this.options.sourcePath();
    return {
      sourcePath,
      availableSkills: this.state.connection.availableSkills,
      referenceActiveNoteOnSend: this.options.referenceActiveNoteOnSend(),
      contextReferences: this.options.contextReferenceProvider.contextReferences(sourcePath),
      activeNoteSnapshots: [...this.activeNoteContextSnapshots],
      selectionSnapshots: [...this.selectionContextSnapshots],
      attachments: [...this.attachments],
    };
  }

  preparedInput(text: string, snapshot: ComposerInputSnapshot = this.captureInputSnapshot()): PreparedComposerInput {
    const prepared = preparedUserInputWithWikiLinkMentionsSkillsAndContext(
      text,
      (target) => this.options.noteCandidateProvider.resolveMention(target, snapshot.sourcePath),
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
      this.dispatchSuggestions({
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
      this.dispatchSuggestions({ type: "composer/suggestions-set", suggestions: [] });
      return;
    }
    const suggestions = activeComposerSuggestions(
      beforeCursor,
      this.noteCandidates(),
      state.connection.availableSkills,
      state.threadList.listedThreads,
      state.connection.availableModels,
      this.options.currentModelForSuggestions(),
      {
        activeThreadId: activeThreadState(state)?.id ?? null,
        activeThreadEphemeral: activeThreadState(state)?.lifetime?.kind === "ephemeral",
        activeThreadSubagent: activeThreadState(state)?.provenance?.kind === "subagent",
        contextReferences: this.contextReferences(),
        dailyNoteReferences: () => this.options.noteCandidateProvider.dailyNoteReferences(this.options.sourcePath()),
        permissionProfiles: state.connection.availablePermissionProfiles,
        tagCandidates: () => this.options.noteCandidateProvider.tags(),
      },
    );

    this.dispatchSuggestions({
      type: "composer/suggestions-set",
      suggestions,
      selected: state.composer.suggestSelected >= suggestions.length ? 0 : state.composer.suggestSelected,
    });
  }

  private handleInput(value: string): void {
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
    this.options.onDraftChange();
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
    const suggestions = activeComposerSuggestions(
      beforeCursor,
      this.noteCandidates(),
      state.connection.availableSkills,
      state.threadList.listedThreads,
      state.connection.availableModels,
      this.options.currentModelForSuggestions(),
      {
        activeThreadId: activeThreadState(state)?.id ?? null,
        contextReferences: this.contextReferences(),
        dailyNoteReferences: () => this.options.noteCandidateProvider.dailyNoteReferences(this.options.sourcePath()),
        permissionProfiles: state.connection.availablePermissionProfiles,
        tagCandidates: () => this.options.noteCandidateProvider.tags(),
      },
    );
    return {
      suggestions,
      selected: state.composer.suggestSelected >= suggestions.length ? 0 : state.composer.suggestSelected,
      dismissedSignature: null,
    };
  }

  private selectSuggestion(index: number): void {
    if (this.state.composer.suggestSelected === index) return;
    this.dispatchSuggestions({ type: "composer/suggestions-set", suggestions: this.state.composer.suggestions, selected: index });
  }

  private insertSuggestion(suggestion: ComposerSuggestion | undefined, activation: "enter" | "tab" = "enter"): void {
    if (!suggestion) return;
    const source = composerInsertionSource(this.composer);
    if (!source) return;

    const insertion = applyComposerSuggestionInsertion(source.value, source.cursor, suggestion, { activation });
    if (suggestion.activeNoteContext) this.rememberActiveNoteContextSnapshot(suggestion.activeNoteContext);
    if (suggestion.selectionContext) this.rememberSelectionContextSnapshot(suggestion.selectionContext);
    this.pruneActiveNoteContextSnapshots(insertion.value);
    this.pruneSelectionContextSnapshots(insertion.value);

    this.pendingSelection = { value: insertion.value, cursor: insertion.cursor };
    this.dispatch({ type: "composer/draft-set", draft: insertion.value, clearSuggestions: true });
    this.options.onDraftChange();
    applyComposerInsertionToElement(this.composer, insertion.cursor);
  }

  private readonly clearPendingSelection = (): void => {
    this.pendingSelection = null;
  };

  private clearSuggestions(): void {
    this.dispatchSuggestions({ type: "composer/suggestions-set", suggestions: [], selected: 0 });
  }

  private handleTransferredFiles(files: readonly File[]): void {
    if (files.length === 0) return;
    const handler = this.options.attachmentHandler;
    if (!handler) return;

    const transfer = this.saveTransferredFiles(handler, files);
    this.pendingAttachmentTransfers.add(transfer);
    void transfer.finally(() => {
      this.pendingAttachmentTransfers.delete(transfer);
    });
  }

  private async saveTransferredFiles(handler: ComposerAttachmentHandler, files: readonly File[]): Promise<void> {
    const lifetime = this.lifetime.signal();
    if (!this.lifetime.isCurrent(lifetime)) return;
    try {
      const attachments = await handler.saveFiles(files);
      if (!this.lifetime.isCurrent(lifetime)) return;
      if (attachments.length === 0) return;
      this.attachments = [...this.attachments, ...attachments];
      this.insertAttachmentMarkers(attachments);
    } catch (error) {
      if (!this.lifetime.isCurrent(lifetime)) return;
      this.options.onAttachmentError?.(error instanceof Error ? error.message : String(error));
    }
  }

  private insertAttachmentMarkers(attachments: readonly ComposerAttachment[]): void {
    const markers = attachments.map((attachment) => attachment.marker);
    if (markers.length === 0) return;

    const fallbackSource = {
      value: this.state.composer.draft,
      start: this.state.composer.draft.length,
      end: this.state.composer.draft.length,
    };
    const source = composerRangeInsertionSource(this.composer) ?? fallbackSource;
    const insertion = applyAttachmentMarkerInsertion(source.value, source.start, source.end, markers);
    this.pruneAttachments(insertion.value);
    this.pruneActiveNoteContextSnapshots(insertion.value);
    this.pruneSelectionContextSnapshots(insertion.value);
    this.dispatch({ type: "composer/draft-set", draft: insertion.value, clearSuggestions: true });
    this.options.onDraftChange();
    applyComposerInsertionToElement(this.composer, insertion.cursor);
  }

  private dismissSuggestions(): void {
    this.dispatchSuggestions({
      type: "composer/suggestions-set",
      suggestions: [],
      selected: 0,
      dismissedSignature: this.suggestionSignature(),
    });
  }

  private dispatchSuggestions(action: ChatAction): void {
    this.options.stateStore.dispatch(action);
  }

  private suggestionSignature(): string | null {
    return composerSuggestionSignatureFromElement(this.composer);
  }

  private noteCandidates(): NoteCandidate[] {
    return [...this.options.noteCandidateProvider.candidates(this.options.sourcePath())];
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

  private activeAttachments(text: string): readonly ComposerAttachment[] {
    return this.attachments.filter((attachment) => text.includes(attachment.marker));
  }

  private pruneAttachments(text: string): void {
    this.attachments = [...this.activeAttachments(text)];
  }

  private async submitAfterAttachmentTransfers(actions: ChatComposerRenderActions): Promise<void> {
    if (this.submitAfterAttachmentTransfersActive) return;
    const lifetime = this.lifetime.signal();
    if (!this.lifetime.isCurrent(lifetime)) return;
    this.submitAfterAttachmentTransfersActive = true;
    try {
      while (this.pendingAttachmentTransfers.size > 0) {
        await Promise.allSettled([...this.pendingAttachmentTransfers]);
      }
      if (!this.lifetime.isCurrent(lifetime)) return;
      actions.submit();
    } finally {
      this.submitAfterAttachmentTransfersActive = false;
    }
  }

  private composerCallbacks(actions: ChatComposerRenderActions): ComposerCallbacks {
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
          void this.submitAfterAttachmentTransfers(actions);
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
        if (this.state.pendingSubmission) return;
        void this.submitAfterAttachmentTransfers(actions);
      },
      onHeightChange: () => {
        this.options.onHeightChange();
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

function applyAttachmentMarkerInsertion(
  value: string,
  start: number,
  end: number,
  markers: readonly string[],
): { value: string; cursor: number } {
  const prefix = value.slice(0, start);
  const suffix = value.slice(end);
  const before = prefix && !prefix.endsWith("\n") ? "\n" : "";
  const after = suffix && !suffix.startsWith("\n") ? "\n" : "";
  const inserted = markers.join("\n");
  const nextValue = `${prefix}${before}${inserted}${after}${suffix}`;
  return {
    value: nextValue,
    cursor: prefix.length + before.length + inserted.length,
  };
}
