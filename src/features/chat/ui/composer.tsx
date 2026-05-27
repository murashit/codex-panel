import { setIcon } from "obsidian";
import { useLayoutEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";

import type { ComposerSuggestion } from "../composer/suggestions";
import { IconButton } from "../../../shared/ui/react-components";
import { renderReactRoot, unmountReactRoot } from "../../../shared/ui/react-root";
import { syncTextareaHeight } from "../../../shared/ui/textarea-autogrow";

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
  normalPlaceholder: string,
  callbacks: ComposerCallbacks,
): ComposerElements {
  const elements: Partial<ComposerElements> = {};
  renderReactRoot(
    parent,
    <ComposerShell
      viewId={viewId}
      draft={draft}
      busy={busy}
      normalPlaceholder={normalPlaceholder}
      callbacks={callbacks}
      onComposer={(composer) => {
        elements.composer = composer;
      }}
      onSuggestions={(suggestions) => {
        elements.suggestions = suggestions;
      }}
    />,
  );
  if (!elements.composer || !elements.suggestions) throw new Error("Expected composer shell elements to mount.");
  return { composer: elements.composer, suggestions: elements.suggestions };
}

function ComposerShell({
  viewId,
  draft,
  busy,
  normalPlaceholder,
  callbacks,
  onComposer,
  onSuggestions,
}: {
  viewId: string;
  draft: string;
  busy: boolean;
  normalPlaceholder: string;
  callbacks: ComposerCallbacks;
  onComposer: (composer: HTMLTextAreaElement) => void;
  onSuggestions: (suggestions: HTMLElement) => void;
}): ReactNode {
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const suggestionsRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const composer = composerRef.current;
    const suggestions = suggestionsRef.current;
    if (!composer || !suggestions) return;
    onComposer(composer);
    onSuggestions(suggestions);
    syncComposerHeight(composer);
  }, [onComposer, onSuggestions]);

  return (
    <div className="codex-panel__composer">
      <textarea
        ref={composerRef}
        className="codex-panel-ui__text-input codex-panel__composer-input"
        placeholder={normalPlaceholder}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded="false"
        aria-controls={`${viewId}-composer-suggestions`}
        defaultValue={draft}
        onInput={() => {
          syncComposerHeight(composerRef.current);
          callbacks.onInput();
        }}
        onKeyUp={callbacks.onUpdateSuggestions}
        onClick={callbacks.onUpdateSuggestions}
        onSelect={callbacks.onUpdateSuggestions}
        onKeyDown={(event) => {
          callbacks.onKeydown(event.nativeEvent);
        }}
      />
      <div className="codex-panel-ui__action-stack codex-panel__composer-actions">
        <ComposerIconButton
          icon="message-square"
          label="Start new chat"
          className="codex-panel__new-chat"
          disabled={busy}
          onClick={callbacks.onNewThread}
        />
        <ComposerIconButton icon="send" label="Send" className="codex-panel__send" onClick={callbacks.onSendOrInterrupt} />
      </div>
      <div
        ref={suggestionsRef}
        className="suggestion-container codex-panel__composer-suggestions"
        id={`${viewId}-composer-suggestions`}
        role="listbox"
      />
    </div>
  );
}

function ComposerIconButton({
  icon,
  label,
  className,
  ...props
}: {
  icon: string;
  label: string;
  className: string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "type">): ReactNode {
  return (
    <IconButton
      {...props}
      icon={icon}
      label={label}
      className={`clickable-icon codex-panel-ui__icon-button codex-panel__composer-action ${className}`}
    />
  );
}

export function syncComposerControls(
  parent: HTMLElement | null,
  composer: HTMLTextAreaElement | null,
  busy: boolean,
  canInterrupt: boolean,
  normalPlaceholder: string,
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
    if (sendButton.dataset["codexMode"] !== mode) {
      sendButton.dataset["codexMode"] = mode;
      setButtonIcon(sendButton, interruptMode ? "square" : canSteer ? "corner-down-right" : "send");
    }
  }
  if (composer) {
    composer.setAttr("placeholder", canInterrupt ? "Add steering message..." : normalPlaceholder);
    syncComposerHeight(composer);
  }
}

export function syncComposerHeight(composer: HTMLTextAreaElement | null): void {
  syncTextareaHeight(composer, {
    minHeightFallback: 56,
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

  if (suggestions.length === 0) {
    composer?.setAttr("aria-expanded", "false");
    composer?.removeAttribute("aria-activedescendant");
    unmountReactRoot(suggestionsEl);
    suggestionsEl.hide();
    return;
  }

  composer?.setAttr("aria-expanded", "true");
  suggestionsEl.show();
  renderReactRoot(
    suggestionsEl,
    <ComposerSuggestions
      container={suggestionsEl}
      composer={composer}
      viewId={viewId}
      suggestions={suggestions}
      selectedIndex={selectedIndex}
      callbacks={callbacks}
    />,
  );
}

function ComposerSuggestions({
  container,
  composer,
  viewId,
  suggestions,
  selectedIndex,
  callbacks,
}: {
  container: HTMLElement;
  composer: HTMLTextAreaElement | null;
  viewId: string;
  suggestions: ComposerSuggestion[];
  selectedIndex: number;
  callbacks: Pick<ComposerCallbacks, "onSuggestionHover" | "onSuggestionInsert">;
}): ReactNode {
  const selectedRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const selected = selectedRef.current;
    if (!selected) return;
    composer?.setAttr("aria-activedescendant", selected.id);
    scrollComposerSuggestionIntoView(container, selected);
  }, [composer, container, selectedIndex]);

  return (
    <>
      {suggestions.map((suggestion, index) => {
        const selected = index === selectedIndex;
        const optionId = `${viewId}-composer-suggestion-${String(index)}`;
        return (
          <div
            key={optionId}
            ref={selected ? selectedRef : undefined}
            className={`suggestion-item codex-panel__composer-suggestion ${selected ? "is-selected" : ""}`}
            id={optionId}
            role="option"
            aria-selected={selected ? "true" : "false"}
            tabIndex={-1}
            onMouseMove={() => {
              callbacks.onSuggestionHover(index);
            }}
            onMouseDown={(event) => {
              event.preventDefault();
              callbacks.onSuggestionInsert(suggestion);
            }}
          >
            <span className="suggestion-title codex-panel__suggestion-label">{suggestion.display}</span>
            {suggestion.detail ? <span className="suggestion-note codex-panel__suggestion-detail">{suggestion.detail}</span> : null}
          </div>
        );
      })}
    </>
  );
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

function setButtonIcon(button: HTMLButtonElement, icon: string): void {
  button.replaceChildren();
  setIcon(button, icon);
}
