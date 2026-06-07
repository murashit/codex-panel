import type { App, EventRef } from "obsidian";

import { composerBoundaryScrollDirection, type ComposerBoundaryScrollAction } from "./composer/boundary-scroll";
import { isComposerSendKey, type SendShortcut } from "../../shared/ui/keyboard";
import { textareaCursorAtVisualBoundary } from "../../shared/ui/textarea-caret";
import { noteCandidates as appNoteCandidates, resolveWikiLinkMention as resolveAppWikiLinkMention } from "./composer/obsidian-context";
import {
  activeComposerSuggestions,
  applyComposerSuggestionInsertion,
  composerSuggestionNavigationDirection,
  composerSuggestionSignature,
  nextComposerSuggestionIndex,
  type ComposerSuggestion,
  type NoteCandidate,
} from "./composer/suggestions";
import { userInputWithWikiLinkMentionsAndSkills } from "./composer/wikilink-context";
import type { UserInput } from "../../generated/app-server/v2/UserInput";
import { renderComposerShell, syncComposerHeight } from "./ui/composer";
import { chatTurnBusy, type ChatAction, type ChatState, type ChatStateStore } from "./chat-state";
import type { ComposerMetaViewModel } from "./panel/model";

export interface ChatComposerControllerOptions {
  app: App;
  stateStore: ChatStateStore;
  viewId: string;
  sendShortcut: () => SendShortcut;
  scrollThreadFromComposerEdges: () => boolean;
  canInterrupt: () => boolean;
  composerPlaceholder: () => string;
  composerMeta: () => ComposerMetaViewModel;
  currentModelForSuggestions: () => string | null;
  togglePlan: () => void;
  toggleAutoReview: () => void;
  toggleFast: () => void;
  renderIfDetached: () => void;
  onDraftChange: () => void;
  onComposerResize: () => void;
  onSubmit: () => void;
  onThreadScrollFromComposer: (action: ComposerBoundaryScrollAction) => void;
}

export class ChatComposerController {
  private composer: HTMLTextAreaElement | null = null;
  private parent: HTMLElement | null = null;
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

  render(parent: HTMLElement, options: { updateSuggestions?: boolean } = {}): void {
    this.parent = parent;
    const state = this.state;
    const elements = renderComposerShell(
      parent,
      this.options.viewId,
      state.composer.draft,
      chatTurnBusy(state),
      this.options.canInterrupt(),
      this.options.composerPlaceholder(),
      state.composer.suggestions,
      state.composer.suggestSelected,
      {
        onInput: (value) => {
          this.dispatch({ type: "composer/draft-set", draft: value, resetDismissedSignature: true });
          this.options.onDraftChange();
          this.updateSuggestions({ renderOnChange: false });
          this.refreshControls();
        },
        onComposerResize: () => {
          this.options.onComposerResize();
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
            this.options.onSubmit();
          }
        },
        onSendOrInterrupt: () => {
          this.options.onSubmit();
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
      },
      this.options.composerMeta(),
    );
    this.composer = elements.composer;
    syncComposerHeight(this.composer);
    if (options.updateSuggestions !== false) this.updateSuggestions({ renderOnChange: true });
  }

  setDraft(text: string, options: { focus?: boolean; clearSuggestions?: boolean; renderIfDetached?: boolean } = {}): void {
    this.dispatch({
      type: "composer/draft-set",
      draft: text,
      ...(options.clearSuggestions === undefined ? {} : { clearSuggestions: options.clearSuggestions }),
    });
    this.options.onDraftChange();
    if (!this.composer) {
      if (options.renderIfDetached) this.options.renderIfDetached();
      return;
    }

    this.refreshControls();
    if (options.focus) this.composer.focus();
  }

  focus(): void {
    this.composer?.focus({ preventScroll: true });
  }

  hasFocus(): boolean {
    return this.composer !== null && this.composer.ownerDocument.activeElement === this.composer;
  }

  dispose(): void {
    this.composer = null;
    this.parent = null;
  }

  refreshControls(parent: HTMLElement | null = this.parent, options: { updateSuggestions?: boolean } = {}): void {
    if (!parent) return;
    this.render(parent, options);
  }

  codexInput(text: string): UserInput[] {
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
      this.dispatchSuggestions(
        {
          type: "composer/suggestions-set",
          suggestions: state.composer.suggestions,
          selected: nextComposerSuggestionIndex(state.composer.suggestSelected, state.composer.suggestions.length, direction),
        },
        true,
      );
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
    this.options.onThreadScrollFromComposer(action);
    return true;
  }

  private updateSuggestions({ renderOnChange }: { renderOnChange: boolean } = { renderOnChange: true }): void {
    if (!this.composer) {
      this.clearSuggestions();
      return;
    }

    const cursor = this.composer.selectionStart;
    const signature = this.suggestionSignature();
    const state = this.state;
    if (state.composer.suggestionsDismissedSignature === signature) {
      this.dispatchSuggestions({ type: "composer/suggestions-set", suggestions: [] }, renderOnChange);
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

    this.dispatchSuggestions(
      {
        type: "composer/suggestions-set",
        suggestions,
        selected: state.composer.suggestSelected >= suggestions.length ? 0 : state.composer.suggestSelected,
      },
      renderOnChange,
    );
  }

  private selectSuggestion(index: number): void {
    if (this.state.composer.suggestSelected === index) return;
    this.dispatchSuggestions({ type: "composer/suggestions-set", suggestions: this.state.composer.suggestions, selected: index }, true);
  }

  private insertSuggestion(suggestion: ComposerSuggestion | undefined, activation: "enter" | "tab" = "enter"): void {
    if (!this.composer || !suggestion) return;

    const cursor = this.composer.selectionStart;
    const value = this.composer.value;
    const insertion = applyComposerSuggestionInsertion(value, cursor, suggestion, { activation });

    this.dispatch({ type: "composer/draft-set", draft: insertion.value, clearSuggestions: true });
    this.options.onDraftChange();
    this.refreshControls(this.parent, { updateSuggestions: false });
    syncComposerHeight(this.composer);
    this.composer.focus();
    this.composer.setSelectionRange(insertion.cursor, insertion.cursor);
  }

  private clearSuggestions(): void {
    this.dispatchSuggestions({ type: "composer/suggestions-set", suggestions: [], selected: 0 }, true);
  }

  private dismissSuggestions(): void {
    this.dispatchSuggestions(
      {
        type: "composer/suggestions-set",
        suggestions: [],
        selected: 0,
        dismissedSignature: this.suggestionSignature(),
      },
      true,
    );
  }

  private dispatchSuggestions(action: ChatAction, renderOnChange: boolean): void {
    const previous = this.state;
    const next = this.options.stateStore.dispatch(action);
    if (renderOnChange && next !== previous) this.refreshControls();
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
}
