import type { ButtonHTMLAttributes, Ref } from "preact";
import { useLayoutEffect, useRef, type ReactNode } from "preact/compat";

import type { ComposerSuggestion } from "../composer/suggestions";
import { IconButton } from "../../../shared/ui/react-components";
import { renderReactRoot } from "../../../shared/ui/react-root";
import { syncTextareaHeight } from "../../../shared/ui/textarea-autogrow";

export interface ComposerElements {
  composer: HTMLTextAreaElement;
}

export interface ComposerCallbacks {
  onInput: (value: string) => void;
  onComposerResize: () => void;
  onUpdateSuggestions: () => void;
  onKeydown: (event: KeyboardEvent) => void;
  onNewThread: () => void;
  onSendOrInterrupt: () => void;
  onSuggestionHover: (index: number) => void;
  onSuggestionInsert: (suggestion: ComposerSuggestion) => void;
}

type ButtonProps = ButtonHTMLAttributes & {
  disabled?: boolean | undefined;
};

export function renderComposerShell(
  parent: HTMLElement,
  viewId: string,
  draft: string,
  busy: boolean,
  canInterrupt: boolean,
  normalPlaceholder: string,
  suggestions: readonly ComposerSuggestion[],
  selectedSuggestionIndex: number,
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
      suggestions={suggestions}
      selectedSuggestionIndex={selectedSuggestionIndex}
      callbacks={callbacks}
      onComposer={(composer) => {
        elements.composer = composer;
      }}
    />,
  );
  if (!elements.composer) throw new Error("Expected composer shell elements to mount.");
  return { composer: elements.composer };
}

function ComposerShell({
  viewId,
  draft,
  busy,
  canInterrupt,
  normalPlaceholder,
  suggestions,
  selectedSuggestionIndex,
  callbacks,
  onComposer,
}: {
  viewId: string;
  draft: string;
  busy: boolean;
  canInterrupt: boolean;
  normalPlaceholder: string;
  suggestions: readonly ComposerSuggestion[];
  selectedSuggestionIndex: number;
  callbacks: ComposerCallbacks;
  onComposer: (composer: HTMLTextAreaElement) => void;
}): ReactNode {
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const suggestionsRef = useRef<HTMLDivElement | null>(null);
  const selectedSuggestionRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;
    onComposer(composer);
    syncComposerHeight(composer);
  }, [onComposer]);
  useLayoutEffect(() => {
    const container = suggestionsRef.current;
    const selected = selectedSuggestionRef.current;
    if (!container || !selected) return;
    scrollComposerSuggestionIntoView(container, selected);
  }, [suggestions, selectedSuggestionIndex]);
  const sendMode = composerSendMode(busy, canInterrupt, draft);
  const normalizedSelectedSuggestionIndex = suggestions.length === 0 ? 0 : Math.min(selectedSuggestionIndex, suggestions.length - 1);
  const selectedSuggestionId =
    suggestions.length > 0 ? `${viewId}-composer-suggestion-${String(normalizedSelectedSuggestionIndex)}` : undefined;

  return (
    <div className="codex-panel__composer">
      <textarea
        ref={composerRef}
        className="codex-panel-ui__text-input codex-panel__composer-input"
        placeholder={sendMode.canInterrupt ? "Add steering message..." : normalPlaceholder}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={suggestions.length > 0 ? "true" : "false"}
        aria-controls={`${viewId}-composer-suggestions`}
        aria-activedescendant={selectedSuggestionId}
        value={draft}
        onChange={(event) => {
          if (syncComposerHeight(event.currentTarget)) callbacks.onComposerResize();
          callbacks.onInput(event.currentTarget.value);
        }}
        onKeyUp={callbacks.onUpdateSuggestions}
        onClick={callbacks.onUpdateSuggestions}
        onSelect={callbacks.onUpdateSuggestions}
        onKeyDown={(event) => {
          callbacks.onKeydown(event);
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
      <ComposerSuggestions
        containerRef={suggestionsRef}
        selectedRef={selectedSuggestionRef}
        viewId={viewId}
        suggestions={suggestions}
        selectedIndex={normalizedSelectedSuggestionIndex}
        callbacks={callbacks}
      />
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
} & Omit<ButtonProps, "className" | "type">): ReactNode {
  return (
    <IconButton
      {...props}
      icon={icon}
      label={label}
      className={`clickable-icon codex-panel-ui__icon-button codex-panel__composer-action ${className}`}
    />
  );
}

export function syncComposerHeight(composer: HTMLTextAreaElement | null): boolean {
  const previousHeight = composer?.style.height ?? "";
  const previousOverflowY = composer?.style.overflowY ?? "";
  syncTextareaHeight(composer, {
    minHeightFallback: 56,
    maxHeightFallback: composer ? Math.min(208, composer.win.innerHeight * 0.4) : 208,
  });
  return Boolean(composer && (composer.style.height !== previousHeight || composer.style.overflowY !== previousOverflowY));
}

function ComposerSuggestions({
  containerRef,
  selectedRef,
  viewId,
  suggestions,
  selectedIndex,
  callbacks,
}: {
  containerRef: Ref<HTMLDivElement>;
  selectedRef: Ref<HTMLDivElement>;
  viewId: string;
  suggestions: readonly ComposerSuggestion[];
  selectedIndex: number;
  callbacks: Pick<ComposerCallbacks, "onSuggestionHover" | "onSuggestionInsert">;
}): ReactNode {
  return (
    <div
      ref={containerRef}
      className="codex-panel__composer-suggestions"
      id={`${viewId}-composer-suggestions`}
      role="listbox"
      hidden={suggestions.length === 0}
    >
      {suggestions.map((suggestion, index) => {
        const selected = index === selectedIndex;
        const optionId = `${viewId}-composer-suggestion-${String(index)}`;
        return (
          <div
            key={optionId}
            ref={selected ? selectedRef : null}
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
    </div>
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
