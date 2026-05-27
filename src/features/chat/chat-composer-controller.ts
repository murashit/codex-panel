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
import type { ChatState } from "./chat-state";
import { unmountReactRoot } from "../../shared/ui/react-root";

export interface ChatComposerControllerOptions {
  app: App;
  state: ChatState;
  viewId: string;
  sendShortcut: () => SendShortcut;
  canInterrupt: () => boolean;
  composerPlaceholder: () => string;
  currentModelForSuggestions: () => string | null;
  renderIfDetached: () => void;
  onDraftChange: () => void;
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

  get trimmedDraft(): string {
    return this.composer?.value.trim() ?? this.options.state.composerDraft.trim();
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
    const elements = renderComposerShell(
      parent,
      this.options.viewId,
      this.options.state.composerDraft,
      this.options.state.busy,
      this.options.canInterrupt(),
      this.options.composerPlaceholder(),
      {
        onInput: () => {
          this.options.state.composerDraft = this.composer?.value ?? "";
          this.options.state.composerSuggestionsDismissedSignature = null;
          this.options.onDraftChange();
          this.updateSuggestions();
          this.refreshControls();
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
    this.options.state.composerDraft = text;
    this.options.onDraftChange();
    if (options.clearSuggestions) this.clearSuggestions();
    if (!this.composer) {
      if (options.renderIfDetached) this.options.renderIfDetached();
      return;
    }

    this.composer.value = text;
    syncComposerHeight(this.composer);
    if (options.focus) this.composer.focus();
    this.refreshControls();
  }

  focus(): void {
    this.composer?.focus({ preventScroll: true });
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
      this.options.state.availableSkills,
    );
  }

  private handleSuggestionKeydown(event: KeyboardEvent): boolean {
    if (event.isComposing) return false;
    if (this.options.state.composerSuggestions.length === 0) return false;

    const direction = composerSuggestionNavigationDirection(event);
    if (direction) {
      event.preventDefault();
      this.options.state.composerSuggestSelected = nextComposerSuggestionIndex(
        this.options.state.composerSuggestSelected,
        this.options.state.composerSuggestions.length,
        direction,
      );
      this.renderSuggestions();
      return true;
    }
    if (event.metaKey || event.ctrlKey) return false;

    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      this.insertSuggestion(this.options.state.composerSuggestions[this.options.state.composerSuggestSelected]);
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
    if (this.options.state.composerSuggestionsDismissedSignature === signature) {
      this.options.state.composerSuggestions = [];
      this.renderSuggestions();
      return;
    }
    const beforeCursor = this.composer.value.slice(0, cursor);
    const suggestions = activeComposerSuggestions(
      beforeCursor,
      this.noteCandidates(),
      this.options.state.availableSkills,
      this.options.state.listedThreads,
      this.options.state.availableModels,
      this.options.currentModelForSuggestions(),
    );

    this.options.state.composerSuggestions = suggestions;
    if (this.options.state.composerSuggestSelected >= this.options.state.composerSuggestions.length) {
      this.options.state.composerSuggestSelected = 0;
    }
    this.renderSuggestions();
  }

  private renderSuggestions(): void {
    renderComposerSuggestions(
      this.suggestionsEl,
      this.composer,
      this.options.viewId,
      this.options.state.composerSuggestions,
      this.options.state.composerSuggestSelected,
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
    if (this.options.state.composerSuggestSelected === index) return;
    this.options.state.composerSuggestSelected = index;
    this.renderSuggestions();
  }

  private insertSuggestion(suggestion: ComposerSuggestion | undefined): void {
    if (!this.composer || !suggestion) return;

    const cursor = this.composer.selectionStart;
    const value = this.composer.value;
    const insertion = applyComposerSuggestionInsertion(value, cursor, suggestion);

    this.options.state.composerDraft = insertion.value;
    this.options.onDraftChange();
    this.composer.value = insertion.value;
    syncComposerHeight(this.composer);
    this.composer.focus();
    this.composer.setSelectionRange(insertion.cursor, insertion.cursor);
    this.clearSuggestions();
  }

  private clearSuggestions(): void {
    this.options.state.composerSuggestSelected = 0;
    this.options.state.composerSuggestions = [];
    this.composer?.setAttr("aria-expanded", "false");
    this.composer?.removeAttribute("aria-activedescendant");
    unmountReactRoot(this.suggestionsEl);
    this.suggestionsEl?.hide();
  }

  private dismissSuggestions(): void {
    this.options.state.composerSuggestionsDismissedSignature = this.suggestionSignature();
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
