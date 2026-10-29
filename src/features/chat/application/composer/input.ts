import type { SkillMetadata } from "../../../../domain/runtime/catalog";
import type { RuntimePermissionProfileSummary } from "../../../../domain/runtime/permissions";
import { runtimeConfigOrDefault } from "../../../../domain/runtime/settings";
import type { Thread } from "../../../../domain/threads/model";
import { resolveRuntimeControls } from "../../domain/runtime/resolution";
import { activePanelOperationDecision } from "../panel-operation-policy";
import { type ChatRuntimeSharedResources, runtimeSnapshotForChatState } from "../runtime/snapshot";
import { activePanelOperationForSlashCommandSuggestion } from "../slash-commands/catalog";
import { type ThreadCommandTarget, threadCommandTargetForDraft } from "../slash-commands/thread-arguments";
import { activeThreadState, type ChatState } from "../state/model";
import { capturePanelTargetLease, type PanelTargetLease, panelTargetLeasesMatch } from "../state/panel-target";
import type { ChatAction } from "../state/reducer";
import type { ChatStateStore } from "../state/store";
import { type ComposerSubmissionClaim, SubmissionInput } from "../submission/input-claim";
import { ComposerAttachmentTransfers } from "./attachment-transfers";
import type { ComposerAttachment, ComposerAttachmentHandler } from "./attachments";
import {
  type ActiveNoteContextReference,
  activeNoteContextReferenceMarker,
  type ComposerContextReferenceProvider,
  type ComposerSelectionEmphasis,
  type SelectionContextReference,
  type SelectionContextSnapshot,
} from "./context-references";
import type { FuzzyMatcher } from "./fuzzy-search";
import type { ComposerInputSnapshot } from "./input-snapshot";
import type { NoteCandidateProvider } from "./note-context";
import { composerContextReferences } from "./prepared-input";
import { type ComposerSelection, collapsedComposerSelection } from "./selection";
import { captureSelectionContext, selectionContextMatches } from "./selection-context";
import {
  applyComposerSuggestionInsertion,
  type ComposerSuggestion,
  composerSuggestionSignature,
  nextComposerSuggestionIndex,
} from "./suggestion";
import { activeComposerSuggestions } from "./suggestions";

export interface ComposerInputOptions {
  fuzzyMatcher: FuzzyMatcher;
  noteCandidateProvider: NoteCandidateProvider;
  contextReferenceProvider: ComposerContextReferenceProvider;
  attachmentHandler: ComposerAttachmentHandler;
  sourcePath: () => string;
  stateStore: ChatStateStore;
  referenceActiveNoteOnSend: () => boolean;
  onAttachmentError: (message: string) => void;
  sharedResources: ChatRuntimeSharedResources & {
    skillsSnapshot(): readonly SkillMetadata[] | null;
    permissionProfilesSnapshot(): readonly RuntimePermissionProfileSummary[] | null;
    activeThreadsSnapshot(): readonly Thread[] | null;
    subscribe(listener: () => void): () => void;
  };
  view: {
    selection: () => ComposerSelection | null;
    setSelection: (selection: ComposerSelection | null) => void;
    focus: (options?: { force?: boolean }) => void;
  };
}

interface RetainedComposerSelection extends SelectionContextSnapshot {
  readonly emphasis: ComposerSelectionEmphasis | null;
}

export class ComposerInput {
  private readonly attachmentTransfers: ComposerAttachmentTransfers;
  private attachments: ComposerAttachment[] = [];
  private activeNoteContextSnapshots: ActiveNoteContextReference[] = [];
  private selectionContexts = new Map<string, RetainedComposerSelection>();
  private threadCommandTarget: ThreadCommandTarget | null = null;
  private submissionInput: SubmissionInput | null = null;
  private readonly unsubscribeState: () => void;
  private readonly unsubscribeSharedResources: () => void;
  private observedPanelTarget: PanelTargetLease;
  private observedDraft: string;

  constructor(private readonly options: ComposerInputOptions) {
    this.attachmentTransfers = new ComposerAttachmentTransfers({
      attachmentHandler: options.attachmentHandler,
      stateStore: options.stateStore,
      selection: options.view.selection,
      setSelection: options.view.setSelection,
      focus: () => {
        options.view.focus({ force: true });
      },
      onDraftReplaced: (draft, attachments) => {
        this.attachments = [...this.attachments, ...attachments];
        this.pruneDraftContext(draft);
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
      if (options.view.selection()) this.updateSuggestions();
    });
  }

  private get state(): ChatState {
    return this.options.stateStore.getState();
  }

  get editable(): boolean {
    return !this.state.pendingSubmission && activePanelOperationDecision(this.state, "submit").kind !== "blocked";
  }

  private dispatch(action: ChatAction): void {
    this.options.stateStore.dispatch(action);
  }

  get draft(): string {
    return this.options.view.selection()?.value ?? this.state.composer.draft;
  }

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
      this.pruneDraftContext(text);
    }
    this.dispatch({
      type: "composer/draft-set",
      draft: text,
      ...(options.clearSuggestions === undefined ? {} : { clearSuggestions: options.clearSuggestions }),
    });
    if (options.focus) this.options.view.focus();
  }

  dispose(): void {
    this.submissionInput?.settle("accepted");
    this.unsubscribeState();
    this.unsubscribeSharedResources();
    this.attachmentTransfers.dispose();
    this.clearSelectionContexts();
    this.threadCommandTarget = null;
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
      selectionSnapshots: this.selectionSnapshots(),
      attachments: [...this.attachments],
      ...(threadCommandTarget ? { threadCommandTarget } : {}),
    };
  }

  claimSubmission(): ComposerSubmissionClaim | null {
    if (this.submissionInput) return null;
    const text = this.draft;
    if (!text.trim()) return null;
    const inputSnapshot = this.captureInputSnapshot();
    const claim = this.claimInput(text, inputSnapshot, this.takeSelectionContexts());
    this.attachments = [];
    this.activeNoteContextSnapshots = [];
    this.threadCommandTarget = null;
    this.setDraft("", { clearSuggestions: true, preserveContext: true, threadCommandTarget: null });
    return claim;
  }

  claimTextSubmission(text: string, options: { restoreOnFailure?: boolean } = {}): ComposerSubmissionClaim | null {
    if (this.submissionInput || !text.trim()) return null;
    return this.claimInput(
      text,
      {
        sourcePath: "",
        availableSkills: [],
        referenceActiveNoteOnSend: false,
        contextReferences: { activeNote: null, selection: null },
        activeNoteSnapshots: [],
        selectionSnapshots: [],
        attachments: [],
      },
      new Map(),
      options.restoreOnFailure,
    );
  }

  private claimInput(
    text: string,
    inputSnapshot: ComposerInputSnapshot,
    claimedSelectionContexts: Map<string, RetainedComposerSelection>,
    restoreOnFailure = true,
  ): ComposerSubmissionClaim {
    const claim = new SubmissionInput(
      text,
      inputSnapshot,
      () => this.state,
      (outcome, replacementDraft) => {
        this.submissionInput = null;
        if (outcome !== "failed" || !restoreOnFailure) {
          releaseSelectionContexts(claimedSelectionContexts);
          if (outcome === "accepted" && replacementDraft !== undefined) {
            this.setDraft(prependClaimedDraft(replacementDraft, this.draft), {
              focus: true,
              clearSuggestions: true,
              preserveContext: true,
            });
          }
          return;
        }

        const restoredDraft = prependClaimedDraft(text, this.draft);
        this.attachments = mergeByMarker(inputSnapshot.attachments, this.attachments, (attachment) => attachment.marker);
        this.activeNoteContextSnapshots = mergeByMarker(
          inputSnapshot.activeNoteSnapshots,
          this.activeNoteContextSnapshots,
          activeNoteContextReferenceMarker,
        );
        this.setDraft(restoredDraft, {
          focus: true,
          clearSuggestions: true,
          preserveContext: true,
          threadCommandTarget: inputSnapshot.threadCommandTarget ?? this.threadCommandTarget,
        });
        this.restoreClaimedSelectionContexts(claimedSelectionContexts);
      },
    );
    this.submissionInput = claim;
    return claim;
  }

  isSubmissionPreparing(): boolean {
    return this.submissionInput !== null;
  }

  failActiveSubmissionClaim(): void {
    this.submissionInput?.settle("failed");
  }

  private reconcilePanelTarget(): void {
    const state = this.state;
    const panelTarget = capturePanelTargetLease(state);
    if (panelTargetLeasesMatch(panelTarget, this.observedPanelTarget)) {
      this.observedDraft = state.composer.draft;
      return;
    }

    const carriedDraft = this.observedDraft;
    this.observedPanelTarget = panelTarget;
    this.observedDraft = state.composer.draft;

    const adoption = this.submissionInput?.reconcilePanelTarget();
    if (adoption) {
      const { replacementDraft } = adoption;
      const adoptedDraft = replacementDraft === undefined ? carriedDraft : prependClaimedDraft(replacementDraft, carriedDraft);
      this.setDraft(adoptedDraft, {
        preserveContext: true,
        threadCommandTarget: this.threadCommandTarget,
      });
      return;
    }

    this.attachments = [];
    this.activeNoteContextSnapshots = [];
    this.clearSelectionContexts();
    this.threadCommandTarget = null;
  }

  updateSuggestions(): void {
    if (!this.editable) return;
    const { suggestions, selected, dismissedSignature } = this.inputSuggestionState();
    this.dispatch({
      type: "composer/suggestions-set",
      suggestions,
      selected: dismissedSignature === null ? selected : this.state.composer.suggestSelected,
    });
  }

  editDraft(value: string): void {
    if (!this.editable) return;
    this.pruneThreadCommandTarget(value);
    this.pruneDraftContext(value);
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
    const selection = this.options.view.selection();
    if (!selection) return { suggestions: [], selected: 0, dismissedSignature: null };
    const signature = this.suggestionSignature();
    const state = this.state;
    if (state.composer.suggestionsDismissedSignature === signature) {
      return { suggestions: [], selected: 0, dismissedSignature: signature };
    }
    const suggestions = this.activeSuggestions(selection.value.slice(0, selection.start), state);
    return {
      suggestions,
      selected: state.composer.suggestSelected >= suggestions.length ? 0 : state.composer.suggestSelected,
      dismissedSignature: null,
    };
  }

  private activeSuggestions(beforeCursor: string, state: ChatState): readonly ComposerSuggestion[] {
    return activeComposerSuggestions(
      beforeCursor,
      () => this.options.noteCandidateProvider.candidates(this.options.sourcePath()),
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

  selectSuggestion(index: number): void {
    if (!this.editable) return;
    if (this.state.composer.suggestSelected === index) return;
    this.dispatch({ type: "composer/suggestions-set", suggestions: this.state.composer.suggestions, selected: index });
  }

  insertSuggestion(suggestion: ComposerSuggestion | undefined, activation: "enter" | "tab" = "enter"): void {
    if (!this.editable) return;
    if (!suggestion) return;
    const source = this.options.view.selection();
    if (!source) return;

    const selection = suggestion.selectionContext;
    if (selection?.range === null) {
      const current = this.options.contextReferenceProvider.contextReferences(this.options.sourcePath()).selection;
      if (current?.range !== null || current.selectionId !== selection.selectionId || current.path !== selection.path) {
        this.updateSuggestions();
        return;
      }
    }

    const snapshot = selection
      ? captureSelectionContext(selection, [
          ...this.selectionSnapshots(),
          ...(this.submissionInput?.inputSnapshot.selectionSnapshots ?? []),
        ])
      : null;
    const insertion = applyComposerSuggestionInsertion(
      source.value,
      source.start,
      snapshot ? { ...suggestion, replacement: snapshot.marker } : suggestion,
      { activation },
    );
    this.threadCommandTarget = suggestion.threadCommandTarget ?? threadCommandTargetForDraft(insertion.value, this.threadCommandTarget);
    if (suggestion.activeNoteContext) this.rememberActiveNoteContextSnapshot(suggestion.activeNoteContext);
    if (snapshot && selection) this.rememberSelectionContextSnapshot(snapshot, selection);
    this.pruneActiveNoteContextSnapshots(insertion.value);
    this.pruneSelectionContextSnapshots(insertion.value);

    this.options.view.setSelection(collapsedComposerSelection(insertion.value, insertion.cursor));
    this.dispatch({ type: "composer/draft-set", draft: insertion.value, clearSuggestions: true });
    this.options.view.focus({ force: true });
  }

  dismissSuggestions(): void {
    this.dispatch({
      type: "composer/suggestions-set",
      suggestions: [],
      selected: 0,
      dismissedSignature: this.suggestionSignature(),
    });
  }

  private suggestionSignature(): string | null {
    const selection = this.options.view.selection();
    return selection ? composerSuggestionSignature(selection.value, selection.start) : null;
  }

  private currentModelForSuggestions(): string | null {
    const state = this.state;
    const config = runtimeConfigOrDefault(this.options.sharedResources.runtimeConfigSnapshot());
    return resolveRuntimeControls(runtimeSnapshotForChatState(state, this.options.sharedResources), config).model.effective;
  }

  private contextReferences() {
    return composerContextReferences(this.captureInputSnapshot());
  }

  private rememberActiveNoteContextSnapshot(activeNote: ActiveNoteContextReference): void {
    const marker = activeNoteContextReferenceMarker(activeNote);
    this.activeNoteContextSnapshots = [
      ...this.activeNoteContextSnapshots.filter((snapshot) => activeNoteContextReferenceMarker(snapshot) !== marker),
      activeNote,
    ];
  }

  private rememberSelectionContextSnapshot(snapshot: SelectionContextSnapshot, selection: SelectionContextReference): void {
    const { marker } = snapshot;
    this.selectionContexts.get(marker)?.emphasis?.release();
    this.selectionContexts.delete(marker);
    const emphasis = this.options.contextReferenceProvider.retainSelectionEmphasis(selection);
    this.selectionContexts.set(marker, { ...snapshot, emphasis });
  }

  private pruneSelectionContextSnapshots(text: string): void {
    const retained = new Set(selectionContextMatches(text, this.selectionSnapshots()).matches.map((match) => match.snapshot.marker));
    for (const [marker, selection] of this.selectionContexts) {
      if (retained.has(marker)) continue;
      selection.emphasis?.release();
      this.selectionContexts.delete(marker);
    }
  }

  private selectionSnapshots(): SelectionContextSnapshot[] {
    return [...this.selectionContexts.values()].map(({ reference, marker }) => ({ reference, marker }));
  }

  private clearSelectionContexts(): void {
    releaseSelectionContexts(this.selectionContexts);
  }

  private takeSelectionContexts(): Map<string, RetainedComposerSelection> {
    const contexts = this.selectionContexts;
    this.selectionContexts = new Map();
    for (const selection of contexts.values()) selection.emphasis?.setEnabled(false);
    return contexts;
  }

  private restoreClaimedSelectionContexts(claimed: Map<string, RetainedComposerSelection>): void {
    const current = this.selectionContexts;
    const restored = new Map<string, RetainedComposerSelection>();
    for (const [marker, selection] of claimed) {
      const currentSelection = current.get(marker);
      if (currentSelection) {
        selection.emphasis?.release();
        restored.set(marker, currentSelection);
      } else {
        selection.emphasis?.setEnabled(true);
        restored.set(marker, selection);
      }
    }
    for (const [marker, selection] of current) {
      if (!restored.has(marker)) restored.set(marker, selection);
    }
    this.selectionContexts = restored;
    claimed.clear();
    current.clear();
  }

  private pruneAttachments(draft: string): void {
    this.attachments = this.attachments
      .filter((attachment) => draft.includes(attachment.marker))
      .sort((left, right) => draft.indexOf(left.marker) - draft.indexOf(right.marker));
  }

  private pruneActiveNoteContextSnapshots(text: string): void {
    this.activeNoteContextSnapshots = this.activeNoteContextSnapshots.filter((activeNote) =>
      text.includes(activeNoteContextReferenceMarker(activeNote)),
    );
  }

  private pruneThreadCommandTarget(text: string): void {
    this.threadCommandTarget = threadCommandTargetForDraft(text, this.threadCommandTarget);
  }

  private pruneDraftContext(text: string): void {
    this.pruneAttachments(text);
    this.pruneActiveNoteContextSnapshots(text);
    this.pruneSelectionContextSnapshots(text);
  }

  navigateSuggestions(direction: 1 | -1): void {
    const state = this.state.composer;
    this.selectSuggestion(nextComposerSuggestionIndex(state.suggestSelected, state.suggestions.length, direction));
  }

  transferAttachments(files: readonly File[]): void {
    if (this.editable) this.attachmentTransfers.transfer(files);
  }

  attachmentSaveBlocksSubmit(canInterrupt: boolean): boolean {
    return this.attachmentTransfers.blocksSubmission(canInterrupt);
  }
}

function mergeByMarker<T>(claimed: readonly T[], current: readonly T[], marker: (value: T) => string): T[] {
  const merged = new Map<string, T>();
  for (const value of claimed) merged.set(marker(value), value);
  for (const value of current) merged.set(marker(value), value);
  return [...merged.values()];
}

function releaseSelectionContexts(contexts: Map<string, RetainedComposerSelection>): void {
  for (const selection of contexts.values()) selection.emphasis?.release();
  contexts.clear();
}

function prependClaimedDraft(claimed: string, current: string): string {
  return current.trim().length > 0 ? `${claimed}\n\n${current}` : claimed;
}
