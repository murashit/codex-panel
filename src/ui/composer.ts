import type { ComposerSuggestion } from "../composer/suggestions";
import { createIconButton, setButtonIcon } from "./components";
import { syncTextareaHeight } from "./textarea-autogrow";

export interface ComposerElements {
  composer: HTMLTextAreaElement;
  suggestions: HTMLElement;
}

export interface ComposerCallbacks {
  onInput: () => void;
  onUpdateSuggestions: () => void;
  onKeydown: (event: KeyboardEvent) => void;
  onNewThread: () => void;
  onSendOrInterrupt: () => void;
  onSuggestionHover: (index: number) => void;
  onSuggestionInsert: (suggestion: ComposerSuggestion) => void;
}

export function renderComposerShell(
  parent: HTMLElement,
  viewId: string,
  draft: string,
  busy: boolean,
  callbacks: ComposerCallbacks,
): ComposerElements {
  parent.empty();
  const composerEl = parent.createDiv({ cls: "codex-panel__composer" });
  const composer = composerEl.createEl("textarea", {
    cls: "codex-panel__input",
    attr: {
      placeholder: "Ask Codex to work...",
      role: "combobox",
      "aria-autocomplete": "list",
      "aria-expanded": "false",
      "aria-controls": `${viewId}-composer-suggestions`,
    },
  });
  composer.value = draft;
  syncComposerHeight(composer);
  composer.oninput = () => {
    syncComposerHeight(composer);
    callbacks.onInput();
  };
  composer.onkeyup = callbacks.onUpdateSuggestions;
  composer.onclick = callbacks.onUpdateSuggestions;
  composer.onselect = callbacks.onUpdateSuggestions;
  composer.onkeydown = callbacks.onKeydown;

  const actionsEl = composerEl.createDiv({ cls: "codex-panel__composer-actions" });
  const newThreadButton = createIconButton(
    actionsEl,
    "message-square-plus",
    "New chat",
    "codex-panel__composer-action codex-panel__new-chat",
  );
  newThreadButton.disabled = busy;
  newThreadButton.onclick = callbacks.onNewThread;

  const sendButton = createIconButton(actionsEl, "send", "Send", "codex-panel__composer-action codex-panel__send");
  sendButton.onclick = callbacks.onSendOrInterrupt;

  const suggestions = composerEl.createDiv({
    cls: "suggestion-container codex-panel__composer-suggestions",
    attr: {
      id: `${viewId}-composer-suggestions`,
      role: "listbox",
    },
  });

  return { composer, suggestions };
}

export function syncComposerControls(
  parent: HTMLElement | null,
  composer: HTMLTextAreaElement | null,
  busy: boolean,
  canInterrupt: boolean,
): void {
  const newThreadButton = parent?.querySelector<HTMLButtonElement>(".codex-panel__new-chat");
  if (newThreadButton) newThreadButton.disabled = busy;
  const sendButton = parent?.querySelector<HTMLButtonElement>(".codex-panel__send");
  if (sendButton) {
    const hasDraft = Boolean(composer?.value.trim());
    const canSteer = canInterrupt && hasDraft;
    const interruptMode = canInterrupt && !hasDraft;
    const label = interruptMode ? "Interrupt" : canSteer ? "Steer" : "Send";
    sendButton.disabled = busy && !canInterrupt;
    sendButton.setAttr("aria-label", label);
    sendButton.classList.toggle("is-interrupt", interruptMode);
    sendButton.classList.toggle("is-steer", canSteer);
    const mode = interruptMode ? "interrupt" : canSteer ? "steer" : "send";
    if (sendButton.dataset.codexMode !== mode) {
      sendButton.dataset.codexMode = mode;
      setButtonIcon(sendButton, interruptMode ? "square" : canSteer ? "corner-down-right" : "send");
    }
  }
  if (composer) {
    composer.setAttr("placeholder", canInterrupt ? "Add steering message..." : "Ask Codex to work...");
    syncComposerHeight(composer);
  }
}

export function syncComposerHeight(composer: HTMLTextAreaElement | null): void {
  syncTextareaHeight(composer, {
    minHeightFallback: 76,
    maxHeightFallback: composer ? Math.min(208, composer.win.innerHeight * 0.4) : 208,
  });
}

export function renderComposerSuggestions(
  suggestionsEl: HTMLElement | null,
  composer: HTMLTextAreaElement | null,
  viewId: string,
  suggestions: ComposerSuggestion[],
  selectedIndex: number,
  callbacks: Pick<ComposerCallbacks, "onSuggestionHover" | "onSuggestionInsert">,
): void {
  if (!suggestionsEl) return;
  suggestionsEl.empty();

  if (suggestions.length === 0) {
    composer?.setAttr("aria-expanded", "false");
    composer?.removeAttribute("aria-activedescendant");
    suggestionsEl.hide();
    return;
  }

  composer?.setAttr("aria-expanded", "true");
  suggestionsEl.show();
  let selectedOption: HTMLElement | null = null;
  for (const [index, suggestion] of suggestions.entries()) {
    const optionId = `${viewId}-composer-suggestion-${String(index)}`;
    const option = suggestionsEl.createDiv({
      cls: `suggestion-item codex-panel__composer-suggestion ${index === selectedIndex ? "is-selected" : ""}`,
      attr: {
        id: optionId,
        role: "option",
        "aria-selected": index === selectedIndex ? "true" : "false",
        tabindex: "-1",
      },
    });
    if (index === selectedIndex) {
      composer?.setAttr("aria-activedescendant", optionId);
      selectedOption = option;
    }
    option.createSpan({ cls: "suggestion-title codex-panel__suggestion-label", text: suggestion.display });
    if (suggestion.detail) {
      option.createSpan({ cls: "suggestion-note codex-panel__suggestion-detail", text: suggestion.detail });
    }
    option.onmousemove = () => {
      callbacks.onSuggestionHover(index);
    };
    option.onmousedown = (event) => {
      event.preventDefault();
      callbacks.onSuggestionInsert(suggestion);
    };
  }
  if (selectedOption) scrollComposerSuggestionIntoView(suggestionsEl, selectedOption);
}

export function scrollComposerSuggestionIntoView(container: HTMLElement, option: HTMLElement): void {
  const optionTop = option.offsetTop;
  const optionBottom = optionTop + option.offsetHeight;
  const viewportTop = container.scrollTop;
  const viewportBottom = viewportTop + container.clientHeight;

  if (optionTop < viewportTop) {
    container.scrollTop = Math.max(0, optionTop);
  } else if (optionBottom > viewportBottom) {
    container.scrollTop = Math.max(0, optionBottom - container.clientHeight);
  }
}
