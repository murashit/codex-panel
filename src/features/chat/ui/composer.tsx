import type { ButtonHTMLAttributes, Ref, ComponentChild as UiNode } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";

import { IconButton } from "../../../shared/obsidian/components.obsidian";
import {
  type ComposerMetaPickerState,
  closeComposerMetaPickerOnOutsidePointer,
  composerMetaPickerState,
  observeComposerMetaStatusOverflow,
  preserveComposerSelection,
  renderComposerMetaIcon,
  restoreComposerCursor,
  restoreComposerSelection,
  scrollComposerSuggestionIntoView,
  syncComposerHeight,
} from "./composer.dom";

export interface ComposerSuggestion {
  display: string;
  detail: string;
  replacement: string;
  start: number;
  appendSpaceOnInsert?: boolean;
  tabCursorOffset?: number;
  suffixOnInsert?: string;
}

export interface ComposerPendingSelection {
  value: string;
  cursor: number;
}

export interface ComposerMetaViewModel {
  fatal: string | null;
  context: ComposerContextMeterViewModel;
  statusSummary: string;
  model: string;
  effort: string | null;
  planActive: boolean;
  autoReviewActive: boolean;
  fastActive: boolean;
  modelChoices?: RuntimeChoice[];
  effortChoices?: RuntimeChoice[];
}

interface RuntimeChoice {
  label: string;
  selected?: boolean;
  disabled?: boolean;
  meta?: string;
  onClick: () => void;
}

interface ComposerContextMeterCellViewModel {
  text: string;
  placeholder: boolean;
}

interface ComposerContextMeterViewModel {
  cells: ComposerContextMeterCellViewModel[];
  percent: string;
}

const COMPOSER_CONTEXT_METER_CELL_IDS = ["context-0", "context-1", "context-2", "context-3"] as const;

export interface ComposerCallbacks {
  onInput: (value: string) => void;
  onUpdateSuggestions: () => void;
  onKeydown: (event: KeyboardEvent) => void;
  onPaste?: (event: ClipboardEvent) => void;
  onDrop?: (event: DragEvent) => void;
  onDragOver?: (event: DragEvent) => void;
  onSendOrInterrupt: () => void;
  onHeightChange: () => void;
  onTogglePlan?: () => void;
  onToggleAutoReview?: () => void;
  onToggleFast?: () => void;
  onSuggestionHover: (index: number) => void;
  onSuggestionInsert: (suggestion: ComposerSuggestion) => void;
}

type ButtonProps = ButtonHTMLAttributes & {
  disabled?: boolean | undefined;
};

export interface ComposerShellProps {
  viewId: string;
  draft: string;
  busy: boolean;
  canInterrupt: boolean;
  submissionDisabled: boolean;
  webSubmissionCancellable: boolean;
  normalPlaceholder: string;
  meta: ComposerMetaViewModel;
  suggestions: readonly ComposerSuggestion[];
  selectedSuggestionIndex: number;
  pendingSelection?: ComposerPendingSelection | null;
  onPendingSelectionApplied?: () => void;
  callbacks: ComposerCallbacks;
  onComposer: (composer: HTMLTextAreaElement | null) => void;
}

export function ComposerShell({
  viewId,
  draft,
  busy,
  canInterrupt,
  submissionDisabled,
  webSubmissionCancellable,
  normalPlaceholder,
  meta,
  suggestions,
  selectedSuggestionIndex,
  pendingSelection = null,
  onPendingSelectionApplied,
  callbacks,
  onComposer,
}: ComposerShellProps): UiNode {
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const suggestionsRef = useRef<HTMLDivElement | null>(null);
  const selectedSuggestionRef = useRef<HTMLDivElement | null>(null);
  const previousDraftRef = useRef(draft);
  const onHeightChangeRef = useRef(callbacks.onHeightChange);
  onHeightChangeRef.current = callbacks.onHeightChange;
  const preservedSelection = preserveComposerSelection(composerRef.current, previousDraftRef.current, draft);
  useLayoutEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;
    onComposer(composer);
    syncComposerHeight(composer);
    return () => {
      onComposer(null);
    };
  }, [onComposer]);
  useLayoutEffect(() => {
    const composer = composerRef.current;
    if (syncComposerHeight(composer)) onHeightChangeRef.current();
  }, [draft]);
  useLayoutEffect(() => {
    const container = suggestionsRef.current;
    const selected = selectedSuggestionRef.current;
    if (!container || !selected) return;
    scrollComposerSuggestionIntoView(container, selected);
  }, [suggestions, selectedSuggestionIndex]);
  useLayoutEffect(() => {
    previousDraftRef.current = draft;
    restoreComposerSelection(composerRef.current, preservedSelection);
  });
  useLayoutEffect(() => {
    if (!pendingSelection) return;
    if (pendingSelection.value === draft) restoreComposerCursor(composerRef.current, pendingSelection.cursor);
    onPendingSelectionApplied?.();
  }, [draft, pendingSelection, onPendingSelectionApplied]);
  const sendMode = composerSendMode(busy, canInterrupt, draft, submissionDisabled, webSubmissionCancellable);
  const composerLocked = submissionDisabled;
  const normalizedSelectedSuggestionIndex = suggestions.length === 0 ? 0 : Math.min(selectedSuggestionIndex, suggestions.length - 1);
  const selectedSuggestionId = suggestions.length > 0 ? composerSuggestionOptionId(viewId, normalizedSelectedSuggestionIndex) : undefined;

  return (
    <div className="codex-panel__composer">
      <div className="codex-panel-ui__text-input-frame codex-panel__composer-frame">
        <textarea
          ref={composerRef}
          className="codex-panel-ui__text-input codex-panel__composer-input"
          placeholder={sendMode.canInterrupt ? "Steer the current turn..." : normalPlaceholder}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={suggestions.length > 0 ? "true" : "false"}
          aria-controls={composerSuggestionsListId(viewId)}
          aria-activedescendant={selectedSuggestionId}
          value={draft}
          readOnly={composerLocked}
          onInput={(event) => {
            if (syncComposerHeight(event.currentTarget)) callbacks.onHeightChange();
            callbacks.onInput(event.currentTarget.value);
          }}
          onKeyUp={callbacks.onUpdateSuggestions}
          onClick={callbacks.onUpdateSuggestions}
          onSelect={callbacks.onUpdateSuggestions}
          onKeyDown={(event) => {
            callbacks.onKeydown(event);
          }}
          onPaste={(event) => {
            callbacks.onPaste?.(event);
          }}
          onDrop={(event) => {
            callbacks.onDrop?.(event);
          }}
          onDragOver={(event) => {
            callbacks.onDragOver?.(event);
          }}
        />
        <ComposerMeta meta={meta} sendMode={sendMode} callbacks={callbacks} disabled={composerLocked} />
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
  disabled,
}: {
  meta: ComposerMetaViewModel;
  sendMode: ComposerSendMode;
  callbacks: ComposerCallbacks;
  disabled: boolean;
}): UiNode {
  const metaRef = useRef<HTMLDivElement | null>(null);
  const statusRef = useRef<HTMLSpanElement | null>(null);
  const modelTriggerRef = useRef<HTMLSpanElement | null>(null);
  const effortTriggerRef = useRef<HTMLSpanElement | null>(null);
  const [picker, setPicker] = useState<ComposerMetaPickerState | null>(null);
  useLayoutEffect(() => {
    const status = statusRef.current;
    if (!status) return;
    return observeComposerMetaStatusOverflow(status);
  }, [meta]);
  useLayoutEffect(() => {
    if (!picker) return;
    const metaRoot = metaRef.current;
    if (!metaRoot) return;
    return closeComposerMetaPickerOnOutsidePointer(metaRoot, () => {
      setPicker(null);
    });
  }, [picker]);
  const openPicker = (kind: ComposerMetaPickerKind) => {
    if (disabled) return;
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
              disabled={disabled}
              onMouseDown={() => {
                callbacks.onTogglePlan?.();
              }}
            />
            <ComposerMetaModeButton
              icon="shield"
              active={meta.autoReviewActive}
              disabled={disabled}
              onMouseDown={() => {
                callbacks.onToggleAutoReview?.();
              }}
            />
            <ComposerMetaModeButton
              icon="zap"
              active={meta.fastActive}
              disabled={disabled}
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
              disabled={disabled}
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
                disabled={disabled}
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

type ComposerMetaPickerKind = ComposerMetaPickerState["kind"];

function ComposerContextMeter({ context }: { context: ComposerMetaViewModel["context"] }): UiNode {
  return (
    <span className="codex-panel__composer-meta-context">
      <span className="codex-panel__composer-meta-context-dots">
        {COMPOSER_CONTEXT_METER_CELL_IDS.map((id, index) => {
          const cell = context.cells[index];
          if (!cell) return null;
          return (
            <span
              key={id}
              className={["codex-panel__composer-meta-context-dot", cell.placeholder ? "is-placeholder" : ""].filter(Boolean).join(" ")}
            >
              {cell.text}
            </span>
          );
        })}
      </span>
      <span className="codex-panel__composer-meta-context-percent">{context.percent}</span>
    </span>
  );
}

function ComposerMetaModeButton({
  icon,
  active,
  disabled,
  onMouseDown,
}: {
  icon: string;
  active: boolean;
  disabled: boolean;
  onMouseDown: () => void;
}): UiNode {
  const iconRef = useRef<HTMLSpanElement | null>(null);
  useLayoutEffect(() => {
    const element = iconRef.current;
    if (!element) return;
    renderComposerMetaIcon(element, icon);
  }, [icon]);
  return (
    <span
      ref={iconRef}
      aria-hidden="true"
      className={[
        "codex-panel__composer-meta-trigger",
        "codex-panel__composer-meta-icon",
        active ? "is-active" : "",
        disabled ? "is-disabled" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onMouseDown={(event) => {
        event.preventDefault();
        if (!disabled) onMouseDown();
      }}
    />
  );
}

function ComposerMetaPickerButton({
  triggerRef,
  kind,
  value,
  disabled,
  onMouseDown,
}: {
  triggerRef: Ref<HTMLSpanElement>;
  kind: ComposerMetaPickerKind;
  value: string;
  disabled: boolean;
  onMouseDown: () => void;
}): UiNode {
  return (
    // biome-ignore lint/a11y: Composer meta triggers are visual pointer shortcuts; screen readers get the status summary and full runtime controls remain available through the toolbar and slash commands.
    <span
      ref={triggerRef}
      className={[
        "codex-panel__composer-meta-trigger",
        "codex-panel__composer-meta-value",
        `codex-panel__composer-meta-${kind}`,
        disabled ? "is-disabled" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onMouseDown={(event) => {
        event.preventDefault();
        if (!disabled) onMouseDown();
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
    <div className="codex-panel__composer-meta-popover" data-codex-panel-composer-meta-kind={kind} style={style}>
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
    // biome-ignore lint/a11y: Composer meta choices belong to the visual shortcut popover instead of the accessible control path.
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

function composerSendMode(
  busy: boolean,
  canInterrupt: boolean,
  draft: string,
  submissionDisabled: boolean,
  webSubmissionCancellable: boolean,
): ComposerSendMode {
  if (webSubmissionCancellable) {
    return {
      icon: "square",
      label: "Cancel web import",
      className: "is-interrupt",
      disabled: false,
      canInterrupt: false,
    };
  }
  const hasDraft = Boolean(draft.trim());
  const canSteer = canInterrupt && hasDraft;
  const interruptMode = canInterrupt && !hasDraft;
  return {
    icon: interruptMode ? "square" : canSteer ? "corner-down-right" : "send",
    label: interruptMode ? "Interrupt" : canSteer ? "Steer" : "Send",
    className: interruptMode ? "is-interrupt" : canSteer ? "is-steer" : "",
    disabled: submissionDisabled || (busy && !canInterrupt),
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
      id={composerSuggestionsListId(viewId)}
      role="listbox"
      hidden={suggestions.length === 0}
    >
      {suggestions.map((suggestion, index) => {
        const selected = index === selectedIndex;
        const optionId = composerSuggestionOptionId(viewId, index);
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

function composerSuggestionsListId(viewId: string): string {
  return `${viewId}-composer-suggestions`;
}

function composerSuggestionOptionId(viewId: string, index: number): string {
  return `${viewId}-composer-suggestion-${String(index)}`;
}
