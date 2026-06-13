import type { App, EventRef } from "obsidian";

import type { CodexInput } from "../../../../domain/chat/input";
import { isComposerSendKey, type SendShortcut } from "../../../../shared/ui/keyboard";
import { textareaCursorAtVisualBoundary } from "../../../../shared/ui/textarea-caret";
import { chatTurnBusy, type ChatAction, type ChatState, type ChatStateStore } from "../../state/reducer";
import type { ComposerMetaViewModel, ComposerShellProps } from "../../ui/composer";
import { syncComposerHeight, type ComposerCallbacks } from "../../ui/composer";
import type { ChatPanelComposerShellState } from "../../ui/shell-state";
import { composerBoundaryScrollDirection, type ComposerBoundaryScrollAction } from "./boundary-scroll";
import { noteCandidates as appNoteCandidates, resolveWikiLinkMention as resolveAppWikiLinkMention } from "./obsidian-context";
import {
  activeComposerSuggestions,
  applyComposerSuggestionInsertion,
  composerSuggestionNavigationDirection,
  composerSuggestionSignature,
  nextComposerSuggestionIndex,
  type ComposerSuggestion,
  type NoteCandidate,
} from "./suggestions";
import { userInputWithWikiLinkMentionsAndSkills } from "./wikilink-context";

export interface ChatComposerControllerOptions {
  app: App;
  stateStore: ChatStateStore;
  viewId: string;
  sendShortcut: () => SendShortcut;
  scrollThreadFromComposerEdges: () => boolean;
  canInterrupt: (state: ChatPanelComposerShellState) => boolean;
  composerPlaceholder: (state: ChatPanelComposerShellState) => string;
  composerMeta: (state: ChatPanelComposerShellState) => ComposerMetaViewModel;
  currentModelForSuggestions: () => string | null;
  threadScrollFromComposer: (action: ComposerBoundaryScrollAction) => void;
  togglePlan: () => void;
  toggleAutoReview: () => void;
  toggleFast: () => void;
  onDraftChange: () => void;
  onHeightChange: () => void;
}

export interface ChatComposerRenderActions {
  submit: () => void;
}

export class ChatComposerController {
  private composer: HTMLTextAreaElement | null = null;
  private noteCandidatesCache: { sourcePath: string; notes: NoteCandidate[] } | null = null;
  private noteEventsRegistered = false;

  constructor(private readonly options: ChatComposerControllerOptions) {}

  private get state(): ChatState {
    return this.options.stateStore.getState();
  }

  private dispatch(action: ChatAction): void {
    this.options.stateStore.dispatch(action);
  }

  get trimmedDraft(): string {
    return this.composer?.value.trim() ?? this.state.composer.draft.trim();
  }

  registerNoteIndexInvalidation(registerEvent: (eventRef: EventRef) => void): void {
    if (this.noteEventsRegistered) return;
    this.noteEventsRegistered = true;
    const invalidate = () => {
      this.noteCandidatesCache = null;
    };
    registerEvent(this.options.app.vault.on("create", invalidate));
    registerEvent(this.options.app.vault.on("delete", invalidate));
    registerEvent(this.options.app.vault.on("rename", invalidate));
    registerEvent(this.options.app.vault.on("modify", invalidate));
  }

  renderState(state: ChatPanelComposerShellState, actions: ChatComposerRenderActions): ComposerShellProps {
    return {
      viewId: this.options.viewId,
      draft: state.composer.draft,
      busy: chatTurnBusy(state),
      canInterrupt: this.options.canInterrupt(state),
      normalPlaceholder: this.options.composerPlaceholder(state),
      suggestions: state.composer.suggestions,
      selectedSuggestionIndex: state.composer.suggestSelected,
      callbacks: this.composerCallbacks(actions),
      meta: this.options.composerMeta(state),
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

  setDraft(text: string, options: { focus?: boolean; clearSuggestions?: boolean } = {}): void {
    this.dispatch({
      type: "composer/draft-set",
      draft: text,
      ...(options.clearSuggestions === undefined ? {} : { clearSuggestions: options.clearSuggestions }),
    });
    this.options.onDraftChange();
    if (options.focus) this.composer?.focus();
  }

  focus(): void {
    this.composer?.focus({ preventScroll: true });
  }

  hasFocus(): boolean {
    return this.composer !== null && this.composer.ownerDocument.activeElement === this.composer;
  }

  dispose(): void {
    this.composer = null;
  }

  refreshSuggestions(): void {
    this.updateSuggestions();
  }

  codexInput(text: string): CodexInput {
    return userInputWithWikiLinkMentionsAndSkills(
      text,
      (target) => resolveAppWikiLinkMention(this.options.app, target),
      this.state.connection.availableSkills,
    );
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
    if (!this.composer || !this.options.scrollThreadFromComposerEdges()) return false;

    const composer = this.composer;
    const action = composerBoundaryScrollDirection(event, composer, {
      cursorAtVisualBoundary: (direction) => textareaCursorAtVisualBoundary(direction, composer),
    });
    if (!action) return false;

    event.preventDefault();
    this.options.threadScrollFromComposer(action);
    return true;
  }

  private updateSuggestions(): void {
    if (!this.composer) {
      this.clearSuggestions();
      return;
    }

    const cursor = this.composer.selectionStart;
    const signature = this.suggestionSignature();
    const state = this.state;
    if (state.composer.suggestionsDismissedSignature === signature) {
      this.dispatchSuggestions({ type: "composer/suggestions-set", suggestions: [] });
      return;
    }
    const beforeCursor = this.composer.value.slice(0, cursor);
    const suggestions = activeComposerSuggestions(
      beforeCursor,
      this.noteCandidates(),
      state.connection.availableSkills,
      state.threadList.listedThreads,
      state.connection.availableModels,
      this.options.currentModelForSuggestions(),
    );

    this.dispatchSuggestions({
      type: "composer/suggestions-set",
      suggestions,
      selected: state.composer.suggestSelected >= suggestions.length ? 0 : state.composer.suggestSelected,
    });
  }

  private handleInput(value: string): void {
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
    const beforeCursor = this.composer.value.slice(0, this.composer.selectionStart);
    const suggestions = activeComposerSuggestions(
      beforeCursor,
      this.noteCandidates(),
      state.connection.availableSkills,
      state.threadList.listedThreads,
      state.connection.availableModels,
      this.options.currentModelForSuggestions(),
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
    if (!this.composer || !suggestion) return;

    const cursor = this.composer.selectionStart;
    const value = this.composer.value;
    const insertion = applyComposerSuggestionInsertion(value, cursor, suggestion, { activation });

    this.dispatch({ type: "composer/draft-set", draft: insertion.value, clearSuggestions: true });
    this.options.onDraftChange();
    syncComposerHeight(this.composer);
    this.composer.focus();
    this.composer.setSelectionRange(insertion.cursor, insertion.cursor);
  }

  private clearSuggestions(): void {
    this.dispatchSuggestions({ type: "composer/suggestions-set", suggestions: [], selected: 0 });
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
    if (!this.composer) return null;
    return composerSuggestionSignature(this.composer.value, this.composer.selectionStart);
  }

  private noteCandidates(): NoteCandidate[] {
    const sourcePath = this.options.app.workspace.getActiveFile()?.path ?? "";
    if (this.noteCandidatesCache?.sourcePath !== sourcePath) {
      this.noteCandidatesCache = { sourcePath, notes: appNoteCandidates(this.options.app) };
    }
    return this.noteCandidatesCache.notes;
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
          actions.submit();
        }
      },
      onSendOrInterrupt: () => {
        actions.submit();
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
