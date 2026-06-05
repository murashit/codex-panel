import { setIcon } from "obsidian";
import type { ButtonHTMLAttributes, ComponentChild as UiNode, Ref } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";

import type { ComposerSuggestion } from "../composer/suggestions";
import type { ComposerMetaViewModel, RuntimeChoice } from "../view-model";
import { IconButton } from "../../../shared/ui/components";
import { renderUiRoot } from "../../../shared/ui/ui-root";
import { syncTextareaHeight } from "../../../shared/ui/textarea-autogrow";

export interface ComposerElements {
  composer: HTMLTextAreaElement;
}

export interface ComposerCallbacks {
  onInput: (value: string) => void;
  onComposerResize: () => void;
  onUpdateSuggestions: () => void;
  onKeydown: (event: KeyboardEvent) => void;
  onSendOrInterrupt: () => void;
  onTogglePlan?: () => void;
  onToggleAutoReview?: () => void;
  onToggleFast?: () => void;
  onSuggestionHover: (index: number) => void;
  onSuggestionInsert: (suggestion: ComposerSuggestion) => void;
}

type ButtonProps = ButtonHTMLAttributes & {
  disabled?: boolean | undefined;
};

const DEFAULT_COMPOSER_META: ComposerMetaViewModel = {
  fatal: null,
  context: {
    cells: [
      { text: "⣀", placeholder: true },
      { text: "⣀", placeholder: true },
      { text: "⣀", placeholder: true },
      { text: "⣀", placeholder: true },
    ],
    percent: "--%",
  },
  statusSummary: "Context unavailable, plan off, auto-review off, fast off, model default, reasoning effort default",
  model: "default",
  effort: null,
  planActive: false,
  autoReviewActive: false,
  fastActive: false,
  modelChoices: [],
  effortChoices: [],
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
  meta: ComposerMetaViewModel = DEFAULT_COMPOSER_META,
): ComposerElements {
  const elements: Partial<ComposerElements> = {};
  renderUiRoot(
    parent,
    <ComposerShell
      viewId={viewId}
      draft={draft}
      busy={busy}
      canInterrupt={canInterrupt}
      normalPlaceholder={normalPlaceholder}
      meta={meta}
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
  meta,
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
  meta: ComposerMetaViewModel;
  suggestions: readonly ComposerSuggestion[];
  selectedSuggestionIndex: number;
  callbacks: ComposerCallbacks;
  onComposer: (composer: HTMLTextAreaElement) => void;
}): UiNode {
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const suggestionsRef = useRef<HTMLDivElement | null>(null);
  const selectedSuggestionRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;
    onComposer(composer);
    if (syncComposerHeight(composer)) callbacks.onComposerResize();
  }, [callbacks, onComposer]);
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
      <div className="codex-panel__composer-frame">
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
          onInput={(event) => {
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
        <ComposerMeta meta={meta} sendMode={sendMode} callbacks={callbacks} />
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

function ComposerMeta({
  meta,
  sendMode,
  callbacks,
}: {
  meta: ComposerMetaViewModel;
  sendMode: ComposerSendMode;
  callbacks: ComposerCallbacks;
}): UiNode {
  const metaRef = useRef<HTMLDivElement | null>(null);
  const statusRef = useRef<HTMLSpanElement | null>(null);
  const modelTriggerRef = useRef<HTMLSpanElement | null>(null);
  const effortTriggerRef = useRef<HTMLSpanElement | null>(null);
  const [picker, setPicker] = useState<ComposerMetaPickerState | null>(null);
  useLayoutEffect(() => {
    const status = statusRef.current;
    if (!status) return;
    const win = status.win;
    let frame = 0;
    const update = () => {
      frame = 0;
      updateComposerMetaStatusOverflow(status);
    };
    const scheduleUpdate = () => {
      if (frame) win.cancelAnimationFrame(frame);
      frame = win.requestAnimationFrame(update);
    };
    update();
    const ResizeObserverCtor = (win as Window & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    const observer = ResizeObserverCtor ? new ResizeObserverCtor(scheduleUpdate) : null;
    observer?.observe(status);
    win.addEventListener("resize", scheduleUpdate);
    return () => {
      if (frame) win.cancelAnimationFrame(frame);
      observer?.disconnect();
      win.removeEventListener("resize", scheduleUpdate);
    };
  }, [meta]);
  useLayoutEffect(() => {
    if (!picker) return;
    const metaRoot = metaRef.current;
    const doc = metaRoot?.ownerDocument;
    if (!metaRoot || !doc) return;
    const closeOnOutsideMouse = (event: MouseEvent) => {
      if (event.target && metaRoot.contains(event.target as Node)) return;
      setPicker(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPicker(null);
    };
    doc.addEventListener("mousedown", closeOnOutsideMouse);
    doc.addEventListener("keydown", closeOnEscape);
    return () => {
      doc.removeEventListener("mousedown", closeOnOutsideMouse);
      doc.removeEventListener("keydown", closeOnEscape);
    };
  }, [picker]);
  const openPicker = (kind: ComposerMetaPickerKind) => {
    const nextPicker = composerMetaPickerState(
      kind,
      kind === "model" ? modelTriggerRef.current : effortTriggerRef.current,
      metaRef.current,
    );
    setPicker((current) => (current?.kind === kind ? null : nextPicker));
  };
  const closePicker = () => {
    setPicker(null);
  };
  if (meta.fatal) {
    return (
      <div className="codex-panel__composer-meta codex-panel__composer-meta--fatal">
        <span className="codex-panel__composer-meta-fatal">{meta.fatal}</span>
        <ComposerSendButton sendMode={sendMode} onSendOrInterrupt={callbacks.onSendOrInterrupt} />
      </div>
    );
  }
  return (
    <div ref={metaRef} className="codex-panel__composer-meta">
      <span ref={statusRef} className="codex-panel__composer-meta-status">
        <span className="codex-panel__composer-meta-summary">{meta.statusSummary}</span>
        <span className="codex-panel__composer-meta-status-visual" aria-hidden="true">
          <span className="codex-panel__composer-meta-modes">
            <ComposerMetaModeButton
              icon="list-todo"
              active={meta.planActive}
              onMouseDown={() => {
                callbacks.onTogglePlan?.();
              }}
            />
            <ComposerMetaModeButton
              icon="shield"
              active={meta.autoReviewActive}
              onMouseDown={() => {
                callbacks.onToggleAutoReview?.();
              }}
            />
            <ComposerMetaModeButton
              icon="zap"
              active={meta.fastActive}
              onMouseDown={() => {
                callbacks.onToggleFast?.();
              }}
            />
          </span>
          <span className="codex-panel__composer-meta-separator">|</span>
          <ComposerContextMeter context={meta.context} />
          <span className="codex-panel__composer-meta-field codex-panel__composer-meta-field--model">
            <span className="codex-panel__composer-meta-separator">|</span>
            <ComposerMetaPickerButton
              triggerRef={modelTriggerRef}
              kind="model"
              value={meta.model}
              onMouseDown={() => {
                openPicker("model");
              }}
            />
          </span>
          {meta.effort ? (
            <span className="codex-panel__composer-meta-field codex-panel__composer-meta-field--effort">
              <span className="codex-panel__composer-meta-separator">|</span>
              <ComposerMetaPickerButton
                triggerRef={effortTriggerRef}
                kind="effort"
                value={meta.effort}
                onMouseDown={() => {
                  openPicker("effort");
                }}
              />
            </span>
          ) : null}
        </span>
      </span>
      {picker ? (
        <ComposerMetaChoicePopover
          kind={picker.kind}
          choices={picker.kind === "model" ? (meta.modelChoices ?? []) : (meta.effortChoices ?? [])}
          left={picker.left}
          onClose={closePicker}
        />
      ) : null}
      <ComposerSendButton sendMode={sendMode} onSendOrInterrupt={callbacks.onSendOrInterrupt} />
    </div>
  );
}

type ComposerMetaPickerKind = "model" | "effort";

interface ComposerMetaPickerState {
  kind: ComposerMetaPickerKind;
  left: number;
}

function composerMetaPickerState(
  kind: ComposerMetaPickerKind,
  trigger: HTMLElement | null,
  metaRoot: HTMLElement | null,
): ComposerMetaPickerState {
  if (!trigger || !metaRoot) return { kind, left: 0 };
  const triggerRect = trigger.getBoundingClientRect();
  const metaRect = metaRoot.getBoundingClientRect();
  return {
    kind,
    left: Math.max(0, triggerRect.left - metaRect.left),
  };
}

const COMPOSER_META_EFFORT_HIDDEN_CLASS = "is-effort-hidden";
const COMPOSER_META_MODEL_HIDDEN_CLASS = "is-model-hidden";

function updateComposerMetaStatusOverflow(status: HTMLElement): void {
  status.classList.remove(COMPOSER_META_EFFORT_HIDDEN_CLASS, COMPOSER_META_MODEL_HIDDEN_CLASS);
  if (!composerMetaStatusOverflowing(status)) return;
  if (status.querySelector(".codex-panel__composer-meta-field--effort")) {
    status.classList.add(COMPOSER_META_EFFORT_HIDDEN_CLASS);
  }
  if (!composerMetaStatusOverflowing(status)) return;
  if (status.querySelector(".codex-panel__composer-meta-field--model")) {
    status.classList.add(COMPOSER_META_MODEL_HIDDEN_CLASS);
  }
}

function composerMetaStatusOverflowing(status: HTMLElement): boolean {
  return status.scrollWidth > status.clientWidth;
}

function ComposerContextMeter({ context }: { context: ComposerMetaViewModel["context"] }): UiNode {
  return (
    <span className="codex-panel__composer-meta-context">
      <span className="codex-panel__composer-meta-context-dots">
        {context.cells.map((cell, index) => (
          <span
            key={index}
            className={["codex-panel__composer-meta-context-dot", cell.placeholder ? "is-placeholder" : ""].filter(Boolean).join(" ")}
          >
            {cell.text}
          </span>
        ))}
      </span>
      <span className="codex-panel__composer-meta-context-percent">{context.percent}</span>
    </span>
  );
}

function ComposerMetaModeButton({ icon, active, onMouseDown }: { icon: string; active: boolean; onMouseDown: () => void }): UiNode {
  const iconRef = useRef<HTMLSpanElement | null>(null);
  useLayoutEffect(() => {
    const element = iconRef.current;
    if (!element) return;
    element.replaceChildren();
    setIcon(element, icon);
  }, [icon]);
  return (
    <span
      ref={iconRef}
      className={["codex-panel__composer-meta-trigger", "codex-panel__composer-meta-icon", active ? "is-active" : ""]
        .filter(Boolean)
        .join(" ")}
      onMouseDown={(event) => {
        event.preventDefault();
        onMouseDown();
      }}
    />
  );
}

function ComposerMetaPickerButton({
  triggerRef,
  kind,
  value,
  onMouseDown,
}: {
  triggerRef: Ref<HTMLSpanElement>;
  kind: ComposerMetaPickerKind;
  value: string;
  onMouseDown: () => void;
}): UiNode {
  return (
    <span
      ref={triggerRef}
      className={`codex-panel__composer-meta-trigger codex-panel__composer-meta-value codex-panel__composer-meta-${kind}`}
      onMouseDown={(event) => {
        event.preventDefault();
        onMouseDown();
      }}
    >
      {value}
    </span>
  );
}

function ComposerMetaChoicePopover({
  kind,
  choices,
  left,
  onClose,
}: {
  kind: ComposerMetaPickerKind;
  choices: RuntimeChoice[];
  left: number;
  onClose: () => void;
}): UiNode {
  const style = {
    "--codex-panel-composer-meta-popover-left": `${String(Math.round(left))}px`,
  };
  return (
    <div className={`codex-panel__composer-meta-popover codex-panel__composer-meta-popover--${kind}`} style={style}>
      {choices.map((choice) => (
        <ComposerMetaChoice key={choice.label} choice={choice} onClose={onClose} />
      ))}
    </div>
  );
}

function ComposerMetaChoice({ choice, onClose }: { choice: RuntimeChoice; onClose: () => void }): UiNode {
  const onSelect = () => {
    if (choice.disabled) return;
    choice.onClick();
    onClose();
  };
  return (
    <div
      className={["codex-panel__composer-meta-option", choice.disabled ? "is-disabled" : ""].filter(Boolean).join(" ")}
      onMouseDown={(event) => {
        event.preventDefault();
        onSelect();
      }}
    >
      {choice.label}
    </div>
  );
}

interface ComposerSendMode {
  icon: string;
  label: string;
  className: string;
  disabled: boolean;
  canInterrupt: boolean;
}

function composerSendMode(busy: boolean, canInterrupt: boolean, draft: string): ComposerSendMode {
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

function ComposerSendButton({ sendMode, onSendOrInterrupt }: { sendMode: ComposerSendMode; onSendOrInterrupt: () => void }): UiNode {
  return (
    <ComposerIconButton
      icon={sendMode.icon}
      label={sendMode.label}
      className={`codex-panel__send ${sendMode.className}`}
      disabled={sendMode.disabled}
      onClick={onSendOrInterrupt}
    />
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
} & Omit<ButtonProps, "className" | "type">): UiNode {
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
}): UiNode {
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
