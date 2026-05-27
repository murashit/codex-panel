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
  canInterrupt: boolean,
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
      canInterrupt={canInterrupt}
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
  canInterrupt,
  normalPlaceholder,
  callbacks,
  onComposer,
  onSuggestions,
}: {
  viewId: string;
  draft: string;
  busy: boolean;
  canInterrupt: boolean;
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
  const draftText = composerRef.current?.value ?? draft;
  const sendMode = composerSendMode(busy, canInterrupt, draftText);

  return (
    <div className="codex-panel__composer">
      <textarea
        ref={composerRef}
        className="codex-panel-ui__text-input codex-panel__composer-input"
        placeholder={sendMode.canInterrupt ? "Add steering message..." : normalPlaceholder}
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
        <ComposerIconButton
          icon={sendMode.icon}
          label={sendMode.label}
          className={`codex-panel__send ${sendMode.className}`}
          disabled={sendMode.disabled}
          onClick={callbacks.onSendOrInterrupt}
        />
      </div>
      <div ref={suggestionsRef} className="codex-panel__composer-suggestions" id={`${viewId}-composer-suggestions`} role="listbox" />
    </div>
  );
}

function composerSendMode(
  busy: boolean,
  canInterrupt: boolean,
  draft: string,
): { icon: string; label: string; className: string; disabled: boolean; canInterrupt: boolean } {
  const hasDraft = Boolean(draft.trim());
  const canSteer = canInterrupt && hasDraft;
  const interruptMode = canInterrupt && !hasDraft;
  return {
    icon: interruptMode ? "square" : canSteer ? "corner-down-right" : "send",
    label: interruptMode ? "Interrupt" : canSteer ? "Steer" : "Send",
    className: interruptMode ? "is-interrupt" : canSteer ? "is-steer" : "",
    disabled: busy && !canInterrupt,
    canInterrupt,
  };
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
            <span className="codex-panel__suggestion-label">{suggestion.display}</span>
            {suggestion.detail ? <span className="codex-panel__suggestion-detail">{suggestion.detail}</span> : null}
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
