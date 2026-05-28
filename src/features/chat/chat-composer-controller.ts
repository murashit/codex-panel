import type { App, EventRef } from "obsidian";

import { isComposerSendKey, type SendShortcut } from "../../shared/ui/keyboard";
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
import { renderComposerShell, renderComposerSuggestions, syncComposerHeight } from "./ui/composer";
import type { ChatAction, ChatState, ChatStateStore } from "./chat-state";
import { unmountReactRoot } from "../../shared/ui/react-root";

export interface ChatComposerControllerOptions {
  app: App;
  stateStore: ChatStateStore;
  viewId: string;
  sendShortcut: () => SendShortcut;
  canInterrupt: () => boolean;
  composerPlaceholder: () => string;
  currentModelForSuggestions: () => string | null;
  renderIfDetached: () => void;
  onDraftChange: () => void;
  onComposerResize: () => void;
  onSubmit: () => void;
  onNewThread: () => void;
}

export class ChatComposerController {
  private composer: HTMLTextAreaElement | null = null;
  private suggestionsEl: HTMLElement | null = null;
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
    return this.composer?.value.trim() ?? this.state.composerDraft.trim();
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

  render(parent: HTMLElement): void {
    this.parent = parent;
    const state = this.state;
    const elements = renderComposerShell(
      parent,
      this.options.viewId,
      state.composerDraft,
      state.busy,
      this.options.canInterrupt(),
      this.options.composerPlaceholder(),
      {
        onInput: (value) => {
          this.dispatch({ type: "composer/draft-set", draft: value, resetDismissedSignature: true });
          this.options.onDraftChange();
          this.updateSuggestions();
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
          if (isComposerSendKey(event, this.options.sendShortcut())) {
            event.preventDefault();
            this.options.onSubmit();
          }
        },
        onNewThread: () => {
          this.options.onNewThread();
        },
        onSendOrInterrupt: () => {
          this.options.onSubmit();
        },
        onSuggestionHover: (index) => {
          this.selectSuggestion(index);
        },
        onSuggestionInsert: (suggestion) => {
          this.insertSuggestion(suggestion);
        },
      },
    );
    this.composer = elements.composer;
    this.suggestionsEl = elements.suggestions;
    syncComposerHeight(this.composer);
    this.updateSuggestions();
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
    unmountReactRoot(this.suggestionsEl);
    this.composer = null;
    this.suggestionsEl = null;
    this.parent = null;
  }

  refreshControls(parent: HTMLElement | null = this.parent): void {
    if (!parent) return;
    this.render(parent);
  }

  codexInput(text: string): UserInput[] {
    return userInputWithWikiLinkMentionsAndSkills(
      text,
      (target) => resolveAppWikiLinkMention(this.options.app, target),
      this.state.availableSkills,
    );
  }

  private handleSuggestionKeydown(event: KeyboardEvent): boolean {
    if (event.isComposing) return false;
    const state = this.state;
    if (state.composerSuggestions.length === 0) return false;

    const direction = composerSuggestionNavigationDirection(event);
    if (direction) {
      event.preventDefault();
      this.dispatch({
        type: "composer/suggestions-set",
        suggestions: state.composerSuggestions,
        selected: nextComposerSuggestionIndex(state.composerSuggestSelected, state.composerSuggestions.length, direction),
      });
      this.renderSuggestions();
      return true;
    }
    if (event.metaKey || event.ctrlKey) return false;

    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      this.insertSuggestion(state.composerSuggestions[state.composerSuggestSelected]);
      return true;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      this.dismissSuggestions();
      return true;
    }

    return false;
  }

  private updateSuggestions(): void {
    if (!this.composer) {
      this.clearSuggestions();
      return;
    }

    const cursor = this.composer.selectionStart;
    const signature = this.suggestionSignature();
    const state = this.state;
    if (state.composerSuggestionsDismissedSignature === signature) {
      this.dispatch({ type: "composer/suggestions-set", suggestions: [] });
      this.renderSuggestions();
      return;
    }
    const beforeCursor = this.composer.value.slice(0, cursor);
    const suggestions = activeComposerSuggestions(
      beforeCursor,
      this.noteCandidates(),
      state.availableSkills,
      state.listedThreads,
      state.availableModels,
      this.options.currentModelForSuggestions(),
    );

    this.dispatch({
      type: "composer/suggestions-set",
      suggestions,
      selected: state.composerSuggestSelected >= suggestions.length ? 0 : state.composerSuggestSelected,
    });
    this.renderSuggestions();
  }

  private renderSuggestions(): void {
    const state = this.state;
    renderComposerSuggestions(
      this.suggestionsEl,
      this.composer,
      this.options.viewId,
      state.composerSuggestions,
      state.composerSuggestSelected,
      {
        onSuggestionHover: (index) => {
          this.selectSuggestion(index);
        },
        onSuggestionInsert: (suggestion) => {
          this.insertSuggestion(suggestion);
        },
      },
    );
  }

  private selectSuggestion(index: number): void {
    if (this.state.composerSuggestSelected === index) return;
    this.dispatch({ type: "composer/suggestions-set", suggestions: this.state.composerSuggestions, selected: index });
    this.renderSuggestions();
  }

  private insertSuggestion(suggestion: ComposerSuggestion | undefined): void {
    if (!this.composer || !suggestion) return;

    const cursor = this.composer.selectionStart;
    const value = this.composer.value;
    const insertion = applyComposerSuggestionInsertion(value, cursor, suggestion);

    this.dispatch({ type: "composer/draft-set", draft: insertion.value });
    this.options.onDraftChange();
    this.refreshControls();
    syncComposerHeight(this.composer);
    this.composer.focus();
    this.composer.setSelectionRange(insertion.cursor, insertion.cursor);
    this.clearSuggestions();
  }

  private clearSuggestions(): void {
    this.dispatch({ type: "composer/suggestions-set", suggestions: [], selected: 0 });
    this.renderSuggestions();
  }

  private dismissSuggestions(): void {
    this.dispatch({
      type: "composer/suggestions-set",
      suggestions: this.state.composerSuggestions,
      dismissedSignature: this.suggestionSignature(),
    });
    this.clearSuggestions();
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
