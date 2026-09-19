import type { Ref, ComponentChild as UiNode } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { disposeDomListeners, listenDomEscapeKey, listenDomEvent, listenOutsideDomEvent } from "../../../../shared/ui/events.dom";
import { Icon, IconButton } from "../../../../shared/ui/icon.dom";
import { syncComposerHeight } from "./height";

interface ComposerSuggestion {
  display: string;
  detail: string;
  replacement: string;
  start: number;
  appendSpaceOnInsert?: boolean;
  tabCursorOffset?: number;
  suffixOnInsert?: string;
}

export interface ComposerPendingSelection extends ComposerTextSelection {
  value: string;
}

export interface ComposerMetaViewModel {
  fatal: string | null;
  context: ComposerContextMeterViewModel;
  statusSummary: string;
  model: string;
  effort: string | null;
  planActive: boolean;
  autoReviewActive: boolean;
  fastAvailable: boolean;
  fastActive: boolean;
  modelChoices: RuntimeChoice[];
  effortChoices: RuntimeChoice[];
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
  onPaste: (event: ClipboardEvent) => void;
  onDrop: (event: DragEvent) => void;
  onDragOver: (event: DragEvent) => void;
  onSendOrInterrupt: () => void;
  onTogglePlan: () => void;
  onToggleAutoReview: () => void;
  onToggleFast: () => void;
  onSuggestionHover: (index: number) => void;
  onSuggestionInsert: (suggestion: ComposerSuggestion) => void;
}

export interface ComposerShellProps {
  cancelFork?: { onCancel: () => void; disabled: boolean } | undefined;
  viewId: string;
  draft: string;
  busy: boolean;
  canInterrupt: boolean;
  submissionDisabled: boolean;
  directInputDisabled: boolean;
  runtimeControlsDisabled: boolean;
  sendDisabled: boolean;
  webSubmissionCancellable: boolean;
  normalPlaceholder: string;
  meta: ComposerMetaViewModel;
  suggestions: readonly ComposerSuggestion[];
  selectedSuggestionIndex: number;
  pendingSelection: ComposerPendingSelection | null;
  onPendingSelectionApplied: () => void;
  callbacks: ComposerCallbacks;
  onComposer: (composer: HTMLTextAreaElement | null) => void;
}

export function ComposerShell({
  cancelFork,
  viewId,
  draft,
  busy,
  canInterrupt,
  submissionDisabled,
  directInputDisabled,
  runtimeControlsDisabled,
  sendDisabled,
  webSubmissionCancellable,
  normalPlaceholder,
  meta,
  suggestions,
  selectedSuggestionIndex,
  pendingSelection,
  onPendingSelectionApplied,
  callbacks,
  onComposer,
}: ComposerShellProps): UiNode {
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const suggestionsRef = useRef<HTMLDivElement | null>(null);
  const selectedSuggestionRef = useRef<HTMLDivElement | null>(null);
  const previousDraftRef = useRef(draft);
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
    syncComposerHeight(composer);
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
    if (pendingSelection.value === draft) restoreComposerSelection(composerRef.current, pendingSelection);
    onPendingSelectionApplied();
  }, [draft, pendingSelection, onPendingSelectionApplied]);
  const sendMode = composerSendMode(
    busy,
    canInterrupt,
    draft,
    submissionDisabled,
    directInputDisabled,
    sendDisabled,
    webSubmissionCancellable,
  );
  const composerLocked = submissionDisabled || directInputDisabled;
  const visibleSuggestions = composerLocked ? [] : suggestions;
  const normalizedSelectedSuggestionIndex = visibleSuggestions.length === 0 ? 0 : Math.min(selectedSuggestionIndex, suggestions.length - 1);
  const selectedSuggestionId =
    visibleSuggestions.length > 0 ? composerSuggestionOptionId(viewId, normalizedSelectedSuggestionIndex) : undefined;

  return (
    <div className="codex-panel__composer">
      <div className="codex-panel-ui__text-input-frame codex-panel__composer-frame">
        <textarea
          ref={composerRef}
          className="codex-panel-ui__text-input codex-panel__composer-input"
          placeholder={sendMode.canInterrupt && !composerLocked ? "Steer the current turn..." : normalPlaceholder}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={visibleSuggestions.length > 0 ? "true" : "false"}
          aria-controls={composerSuggestionsListId(viewId)}
          aria-activedescendant={selectedSuggestionId}
          value={draft}
          readOnly={composerLocked}
          onInput={(event) => {
            syncComposerHeight(event.currentTarget);
            callbacks.onInput(event.currentTarget.value);
          }}
          onKeyUp={callbacks.onUpdateSuggestions}
          onClick={callbacks.onUpdateSuggestions}
          onSelect={callbacks.onUpdateSuggestions}
          onKeyDown={callbacks.onKeydown}
          onPaste={callbacks.onPaste}
          onDrop={callbacks.onDrop}
          onDragOver={(event) => {
            callbacks.onDragOver(event);
          }}
        />
        <ComposerMeta
          cancelFork={cancelFork}
          meta={meta}
          sendMode={sendMode}
          callbacks={callbacks}
          disabled={composerLocked || runtimeControlsDisabled}
        />
      </div>
      <ComposerSuggestions
        containerRef={suggestionsRef}
        selectedRef={selectedSuggestionRef}
        viewId={viewId}
        suggestions={visibleSuggestions}
        selectedIndex={normalizedSelectedSuggestionIndex}
        callbacks={callbacks}
      />
    </div>
  );
}

function ComposerMeta({
  cancelFork,
  meta,
  sendMode,
  callbacks,
  disabled,
}: {
  cancelFork: ComposerShellProps["cancelFork"];
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
        <ComposerActions cancelFork={cancelFork} sendMode={sendMode} onSendOrInterrupt={callbacks.onSendOrInterrupt} />
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
                callbacks.onTogglePlan();
              }}
            />
            <ComposerMetaModeButton
              icon="shield"
              active={meta.autoReviewActive}
              disabled={disabled}
              onMouseDown={() => {
                callbacks.onToggleAutoReview();
              }}
            />
            <ComposerMetaModeButton
              icon="zap"
              active={meta.fastActive}
              disabled={disabled || !meta.fastAvailable}
              onMouseDown={() => {
                callbacks.onToggleFast();
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
          choices={picker.kind === "model" ? meta.modelChoices : meta.effortChoices}
          left={picker.left}
          onClose={closePicker}
        />
      ) : null}
      <ComposerActions cancelFork={cancelFork} sendMode={sendMode} onSendOrInterrupt={callbacks.onSendOrInterrupt} />
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
  return (
    <Icon
      icon={icon}
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
  directInputDisabled: boolean,
  sendDisabled: boolean,
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
  const interruptMode = canInterrupt && (!hasDraft || directInputDisabled);
  const canSteer = canInterrupt && hasDraft && !directInputDisabled;
  return {
    icon: interruptMode ? "square" : canSteer ? "corner-down-right" : "send",
    label: interruptMode ? "Interrupt" : canSteer ? "Steer" : "Send",
    className: interruptMode ? "is-interrupt" : canSteer ? "is-steer" : "",
    disabled: submissionDisabled || (directInputDisabled && !interruptMode) || (sendDisabled && !interruptMode) || (busy && !canInterrupt),
    canInterrupt,
  };
}

function ComposerActions({
  cancelFork,
  sendMode,
  onSendOrInterrupt,
}: {
  cancelFork: ComposerShellProps["cancelFork"];
  sendMode: ComposerSendMode;
  onSendOrInterrupt: () => void;
}): UiNode {
  return (
    <div className="codex-panel__composer-actions">
      {cancelFork ? (
        <IconButton
          icon="arrow-left"
          label="Return to source thread"
          className="clickable-icon codex-panel-ui__icon-button codex-panel__composer-action codex-panel__cancel-fork"
          disabled={cancelFork.disabled}
          onClick={cancelFork.onCancel}
        />
      ) : null}
      <IconButton
        icon={sendMode.icon}
        label={sendMode.label}
        className={`clickable-icon codex-panel-ui__icon-button codex-panel__composer-action codex-panel__send ${sendMode.className}`}
        disabled={sendMode.disabled}
        onClick={onSendOrInterrupt}
      />
    </div>
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
const COMPOSER_META_EFFORT_HIDDEN_CLASS = "is-effort-hidden";

const COMPOSER_META_MODEL_HIDDEN_CLASS = "is-model-hidden";

interface ComposerTextSelection {
  start: number;
  end: number;
  direction: "forward" | "backward" | "none";
}

interface ComposerMetaPickerState {
  kind: "model" | "effort";
  left: number;
}

function preserveComposerSelection(
  composer: HTMLTextAreaElement | null,
  previousDraft: string,
  nextDraft: string,
): ComposerTextSelection | null {
  if (!composer || previousDraft !== nextDraft) return null;
  return {
    start: composer.selectionStart,
    end: composer.selectionEnd,
    direction: composer.selectionDirection,
  };
}

function restoreComposerSelection(composer: HTMLTextAreaElement | null, selection: ComposerTextSelection | null): void {
  if (!composer || !selection) return;
  composer.setSelectionRange(selection.start, selection.end, selection.direction);
}

function observeComposerMetaStatusOverflow(status: HTMLElement): () => void {
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
  const disposeResize = listenDomEvent(win, "resize", scheduleUpdate);
  return () => {
    if (frame) win.cancelAnimationFrame(frame);
    observer?.disconnect();
    disposeResize();
  };
}

function closeComposerMetaPickerOnOutsidePointer(metaRoot: HTMLElement, onClose: () => void): () => void {
  return disposeDomListeners(listenOutsideDomEvent(metaRoot, "mousedown", onClose), listenDomEscapeKey(metaRoot.ownerDocument, onClose));
}

function composerMetaPickerState(
  kind: ComposerMetaPickerState["kind"],
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

function updateComposerMetaStatusOverflow(status: HTMLElement): void {
  status.classList.remove(COMPOSER_META_EFFORT_HIDDEN_CLASS, COMPOSER_META_MODEL_HIDDEN_CLASS, "is-status-hidden");
  if (!composerMetaStatusOverflowing(status)) return;
  if (status.querySelector(".codex-panel__composer-meta-field--effort")) {
    status.classList.add(COMPOSER_META_EFFORT_HIDDEN_CLASS);
  }
  if (!composerMetaStatusOverflowing(status)) return;
  if (status.querySelector(".codex-panel__composer-meta-field--model")) {
    status.classList.add(COMPOSER_META_MODEL_HIDDEN_CLASS);
  }
  if (composerMetaStatusOverflowing(status)) status.classList.add("is-status-hidden");
}

function composerMetaStatusOverflowing(status: HTMLElement): boolean {
  return status.scrollWidth > status.clientWidth;
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
