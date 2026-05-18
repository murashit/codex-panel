import type { App, EventRef } from "obsidian";

import { isComposerSendKey } from "../composer/keys";
import { noteCandidates as appNoteCandidates, resolveWikiLinkMention as resolveAppWikiLinkMention } from "../composer/obsidian-context";
import {
  activeComposerSuggestions,
  applyComposerSuggestionInsertion,
  composerSuggestionNavigationDirection,
  composerSuggestionSignature,
  nextComposerSuggestionIndex,
  type ComposerSuggestion,
  type NoteCandidate,
} from "../composer/suggestions";
import { userInputWithWikiLinkMentionsAndSkills } from "../composer/wikilink-context";
import type { UserInput } from "../generated/app-server/v2/UserInput";
import type { SendShortcut } from "../settings/model";
import { renderComposerShell, renderComposerSuggestions, syncComposerControls, syncComposerHeight } from "../ui/composer";
import type { PanelState } from "./state";

export interface PanelComposerControllerOptions {
  app: App;
  state: PanelState;
  viewId: string;
  sendShortcut: () => SendShortcut;
  canInterrupt: () => boolean;
  currentModelForSuggestions: () => string | null;
  renderIfDetached: () => void;
  onSubmit: () => void;
  onNewThread: () => void;
}

export class PanelComposerController {
  private composer: HTMLTextAreaElement | null = null;
  private suggestionsEl: HTMLElement | null = null;
  private noteCandidatesCache: NoteCandidate[] | null = null;
  private noteEventsRegistered = false;

  constructor(private readonly options: PanelComposerControllerOptions) {}

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
    if (this.composer && parent.contains(this.composer)) {
      return;
    }

    const elements = renderComposerShell(parent, this.options.viewId, this.options.state.composerDraft, this.options.state.busy, {
      onInput: () => {
        this.options.state.composerDraft = this.composer?.value ?? "";
        this.options.state.composerSuggestionsDismissedSignature = null;
        this.updateSuggestions();
        this.syncControls(parent);
      },
      onUpdateSuggestions: () => this.updateSuggestions(),
      onKeydown: (event) => {
        if (this.handleSuggestionKeydown(event)) {
          return;
        }
        if (isComposerSendKey(event, this.options.sendShortcut())) {
          event.preventDefault();
          this.options.onSubmit();
        }
      },
      onNewThread: () => this.options.onNewThread(),
      onSendOrInterrupt: () => this.options.onSubmit(),
      onSuggestionHover: (index) => this.selectSuggestion(index),
      onSuggestionInsert: (suggestion) => this.insertSuggestion(suggestion),
    });
    this.composer = elements.composer;
    this.suggestionsEl = elements.suggestions;
    this.updateSuggestions();
  }

  setDraft(text: string, options: { focus?: boolean; clearSuggestions?: boolean; renderIfDetached?: boolean } = {}): void {
    this.options.state.composerDraft = text;
    if (options.clearSuggestions) this.clearSuggestions();
    if (!this.composer) {
      if (options.renderIfDetached) this.options.renderIfDetached();
      return;
    }

    this.composer.value = text;
    syncComposerHeight(this.composer);
    if (options.focus) this.composer.focus();
  }

  syncControls(parent: HTMLElement | null): void {
    syncComposerControls(parent, this.composer, this.options.state.busy, this.options.canInterrupt());
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
        onSuggestionHover: (index) => this.selectSuggestion(index),
        onSuggestionInsert: (suggestion) => this.insertSuggestion(suggestion),
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
    this.suggestionsEl?.empty();
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
    if (!this.noteCandidatesCache) {
      this.noteCandidatesCache = appNoteCandidates(this.options.app);
    }
    return this.noteCandidatesCache;
  }
}
