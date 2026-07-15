import { type Editor, Notice } from "obsidian";
import type { TargetedKeyboardEvent, ComponentChild as UiNode } from "preact";
import { isComposerSendKey, type SendShortcut } from "../../domain/input/send-shortcut";
import { listenDomEscapeKey, listenDomEvent, listenOutsideDomEvent } from "../../shared/dom/events.dom";
import { renderUiRoot, unmountUiRoot } from "../../shared/dom/preact-root.dom";
import { syncTextareaHeight } from "../../shared/dom/textarea-autogrow.measure";
import { textareaCursorAtVisualBoundary } from "../../shared/dom/textarea-caret.measure";
import { IconButton } from "../../shared/obsidian/components.obsidian";
import { DiffLineList, unifiedDiffDisplayLines } from "../../shared/ui/diff-view";
import { buildSelectionUnifiedDiff } from "./diff";
import {
  canApplySelectionRewrite,
  type SelectionRewriteInstructionHistoryDirection,
  type SelectionRewriteRuntimeSettings,
  type SelectionRewriteState,
} from "./model";

import { positionSelectionRewritePopover } from "./position.dom";
import { SelectionRewriteSession, type SelectionRewriteSessionStatus } from "./session";
import type { SelectionRewriteTransport } from "./transport";

const POPOVER_MARGIN = 8;

function isSelectionRewriteActionKey(event: {
  key: string;
  shiftKey: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey: boolean;
  isComposing: boolean;
}): boolean {
  if (event.isComposing || event.key !== "Enter" || event.shiftKey || event.altKey) return false;
  return true;
}

export interface SelectionRewritePopoverOptions {
  editor: Editor;
  onClose?: () => void;
  runtimeSettings: SelectionRewriteRuntimeSettings;
  sendShortcut: SendShortcut;
  state: SelectionRewriteState;
  transport: SelectionRewriteTransport;
  viewDocument: Document;
  viewWindow: Window;
}

type Cleanup = () => void;

interface SelectionRewriteElements {
  root: HTMLElement;
  instruction: HTMLTextAreaElement | null;
  applyButton: HTMLButtonElement | null;
}

export class SelectionRewritePopover {
  private readonly session: SelectionRewriteSession;
  private elements: SelectionRewriteElements | null = null;
  private readonly cleanups: Cleanup[] = [];

  constructor(private readonly options: SelectionRewritePopoverOptions) {
    this.session = new SelectionRewriteSession(options);
  }

  open(): void {
    this.close();

    const elements = this.createElements();
    this.elements = elements;

    this.addCleanup(
      listenDomEvent(this.options.viewWindow, "resize", () => {
        this.position();
      }),
    );
    this.addCleanup(
      listenDomEvent(
        this.options.viewWindow,
        "scroll",
        () => {
          this.position();
        },
        true,
      ),
    );
    this.addCleanup(
      listenDomEscapeKey(this.options.viewDocument, (event) => {
        event.preventDefault();
        this.cancel();
      }),
    );
    this.addCleanup(
      listenOutsideDomEvent(
        elements.root,
        "pointerdown",
        () => {
          this.cancel();
        },
        true,
      ),
    );

    this.session.setStatus("");
    this.syncInstructionHeight();
    this.syncControls();
    this.position();
    elements.instruction?.focus();
  }

  close(): void {
    const hadElements = this.elements !== null;
    if (!hadElements && !this.session.isGenerating) return;
    if (this.session.isGenerating) this.session.abortGeneration();
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    if (this.elements) {
      unmountUiRoot(this.elements.root);
      this.elements.root.remove();
    }
    this.elements = null;
    this.options.onClose?.();
  }

  private async generate(): Promise<void> {
    const result = await this.session.generate({
      render: () => {
        this.renderView();
      },
      position: () => {
        this.position();
      },
      focusApplyButton: () => {
        this.focusApplyButton();
      },
    });
    if (result === "missing-instruction") {
      new Notice("Enter a rewrite instruction first.");
      this.elements?.instruction?.focus();
    }
  }

  private cancel(): void {
    this.session.cancel();
    this.close();
  }

  private createElements(): SelectionRewriteElements {
    const root = this.options.viewDocument.body.createDiv({ cls: "codex-panel-selection-rewrite" });
    root.setAttr("role", "dialog");
    const elements: SelectionRewriteElements = { root, instruction: null, applyButton: null };
    this.renderView(elements);
    return elements;
  }

  private apply(): void {
    const replacement = this.session.state.replacementText;
    if (replacement === null) return;

    const { editor } = this.options;
    const state = this.session.state;
    const currentText = editor.getRange(state.targetRange.from, state.targetRange.to);
    if (!canApplySelectionRewrite({ currentText, currentNoteText: editor.getValue() }, state)) {
      new Notice("Selection changed. Generate the rewrite again before applying.");
      this.session.setStatus("Selection changed. Generate the rewrite again before applying.");
      this.renderView();
      return;
    }

    editor.replaceRange(replacement, state.targetRange.from, state.targetRange.to, "codex-panel-rewrite");
    this.close();
  }

  private focusApplyButton(): void {
    if (!this.elements?.applyButton || this.elements.applyButton.disabled) return;
    this.elements.applyButton.focus({ preventScroll: true });
  }

  private syncControls(): void {
    this.renderView();
  }

  private syncInstructionHeight(): void {
    const instruction = this.elements?.instruction ?? null;
    syncTextareaHeight(instruction, {
      minHeightFallback: 26,
      maxHeightFallback: instruction ? Math.min(180, instruction.win.innerHeight * 0.3) : 180,
    });
  }

  private position(): void {
    if (!this.elements) return;
    if (!positionSelectionRewritePopover(this.elements.root, this.options.editor, this.options.viewWindow, POPOVER_MARGIN)) this.close();
  }

  private renderView(elements: SelectionRewriteElements | null = this.elements): void {
    if (!elements) return;
    const state = this.session.state;
    const replacement = state.replacementText;
    renderUiRoot(
      elements.root,
      <SelectionRewritePopoverView
        applyButtonRef={(element) => {
          elements.applyButton = element;
        }}
        debugText={state.debugText}
        diff={replacement === null ? null : buildSelectionUnifiedDiff(state.filePath, state.originalText, replacement)}
        generating={state.status === "generating"}
        hasInstruction={this.session.hasInstruction}
        hasReplacement={replacement !== null}
        instruction={this.session.instructionDraft}
        instructionRef={(element) => {
          elements.instruction = element;
        }}
        onApply={() => {
          this.apply();
        }}
        onGenerate={() => void this.generate()}
        onInstructionInput={(value) => {
          this.session.setInstructionDraft(value);
          this.syncInstructionHeight();
          this.syncControls();
          this.position();
        }}
        onInstructionKeyDown={(event) => {
          if (this.handleInstructionHistoryKeyDown(event.currentTarget, event)) return;
          const hasReplacement = this.options.state.replacementText !== null;
          if (!(hasReplacement ? isSelectionRewriteActionKey(event) : isComposerSendKey(event, this.options.sendShortcut))) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          void this.generate();
        }}
        onApplyKeyDown={(event) => {
          if (!isSelectionRewriteActionKey(event)) return;
          event.preventDefault();
          this.apply();
        }}
        status={this.session.status}
        streamPreview={state.streamText.trim()}
      />,
    );
  }

  private handleInstructionHistoryKeyDown(instruction: HTMLTextAreaElement, event: TargetedKeyboardEvent<HTMLTextAreaElement>): boolean {
    const direction = selectionRewriteInstructionHistoryDirection(event, instruction);
    if (direction === null || !this.session.navigateInstructionHistory(direction)) return false;

    event.preventDefault();
    event.stopPropagation();
    this.syncInstructionHeight();
    this.syncControls();
    this.position();
    this.focusInstructionEnd();
    return true;
  }

  private focusInstructionEnd(): void {
    const instruction = this.elements?.instruction;
    if (!instruction) return;
    const cursor = instruction.value.length;
    instruction.focus({ preventScroll: true });
    instruction.setSelectionRange(cursor, cursor);
  }

  private addCleanup(cleanup: Cleanup): void {
    this.cleanups.push(cleanup);
  }
}

function selectionRewriteInstructionHistoryDirection(
  event: TargetedKeyboardEvent<HTMLTextAreaElement>,
  instruction: HTMLTextAreaElement,
): SelectionRewriteInstructionHistoryDirection | null {
  if (event.isComposing || event.metaKey || event.altKey || event.shiftKey) return null;

  const direction = selectionRewriteInstructionHistoryKeyDirection(event);
  if (direction === null) return null;
  if (!selectionRewriteInstructionCursorOnLogicalBoundary(direction, instruction)) return null;
  return textareaCursorAtVisualBoundary(direction, instruction) ? direction : null;
}

function selectionRewriteInstructionHistoryKeyDirection(
  event: TargetedKeyboardEvent<HTMLTextAreaElement>,
): SelectionRewriteInstructionHistoryDirection | null {
  if (!event.ctrlKey) {
    if (event.key === "ArrowUp") return -1;
    if (event.key === "ArrowDown") return 1;
    return null;
  }

  const key = event.key.toLowerCase();
  if (key === "p") return -1;
  if (key === "n") return 1;
  return null;
}

function selectionRewriteInstructionCursorOnLogicalBoundary(
  direction: SelectionRewriteInstructionHistoryDirection,
  instruction: HTMLTextAreaElement,
): boolean {
  if (instruction.selectionStart !== instruction.selectionEnd) return false;
  return direction === -1
    ? !instruction.value.slice(0, instruction.selectionStart).includes("\n")
    : !instruction.value.slice(instruction.selectionEnd).includes("\n");
}

interface SelectionRewritePopoverViewProps {
  applyButtonRef: (element: HTMLButtonElement | null) => void;
  debugText: string | null;
  diff: string | null;
  generating: boolean;
  hasInstruction: boolean;
  hasReplacement: boolean;
  instruction: string;
  instructionRef: (element: HTMLTextAreaElement | null) => void;
  onApply: () => void;
  onApplyKeyDown: (event: TargetedKeyboardEvent<HTMLButtonElement>) => void;
  onGenerate: () => void;
  onInstructionInput: (value: string) => void;
  onInstructionKeyDown: (event: TargetedKeyboardEvent<HTMLTextAreaElement>) => void;
  status: SelectionRewriteSessionStatus;
  streamPreview: string;
}

function SelectionRewritePopoverView({
  applyButtonRef,
  debugText,
  diff,
  generating,
  hasInstruction,
  hasReplacement,
  instruction,
  instructionRef,
  onApply,
  onApplyKeyDown,
  onGenerate,
  onInstructionInput,
  onInstructionKeyDown,
  status,
  streamPreview,
}: SelectionRewritePopoverViewProps): UiNode {
  return (
    <>
      <div className="codex-panel-selection-rewrite__prompt-row">
        <div className="codex-panel-selection-rewrite__composer-frame">
          <textarea
            ref={instructionRef}
            className="codex-panel-ui__text-input codex-panel-selection-rewrite__instruction"
            disabled={generating}
            onInput={(event) => {
              onInstructionInput(event.currentTarget.value);
            }}
            onKeyDown={onInstructionKeyDown}
            placeholder="How should Codex rewrite this selection?"
            value={instruction}
          />
          <IconButton
            icon="sparkles"
            label={hasReplacement ? "Regenerate" : "Generate"}
            className="clickable-icon codex-panel-ui__icon-button codex-panel-selection-rewrite__icon-button"
            disabled={generating || !hasInstruction}
            onClick={onGenerate}
          />
        </div>
      </div>
      <SelectionRewriteStatus status={status} />
      <pre className={`codex-panel-selection-rewrite__stream-preview${streamPreview ? "" : " is-hidden"}`}>{streamPreview}</pre>
      <div className={`codex-panel-selection-rewrite__result${hasReplacement ? "" : " is-hidden"}`}>
        <div className="codex-panel-selection-rewrite__diff">{diff ? <SelectionRewriteDiff diff={diff} /> : null}</div>
        <div className="codex-panel-selection-rewrite__result-actions">
          <IconButton
            buttonRef={applyButtonRef}
            icon="check"
            label="Apply"
            className={`clickable-icon codex-panel-ui__icon-button codex-panel-selection-rewrite__icon-button${
              hasReplacement ? "" : " is-hidden"
            }`}
            disabled={generating || !hasReplacement}
            onClick={onApply}
            onKeyDown={onApplyKeyDown}
          />
        </div>
      </div>
      {debugText ? (
        <details className="codex-panel-selection-rewrite__debug">
          <summary tabIndex={-1}>Debug output</summary>
          <pre>{debugText}</pre>
        </details>
      ) : null}
    </>
  );
}

function SelectionRewriteStatus({ status }: { status: SelectionRewriteSessionStatus }): UiNode {
  const { text, active } = status;
  if (!text && !active) return <div className="codex-panel-selection-rewrite__status" />;
  return (
    <div className={`codex-panel-selection-rewrite__status${active ? " is-active" : ""}`}>
      <span>{text}</span>
      {active ? (
        <span className="codex-panel-selection-rewrite__status-dots">
          <span>.</span>
          <span>.</span>
          <span>.</span>
        </span>
      ) : null}
    </div>
  );
}

function SelectionRewriteDiff({ diff }: { diff: string }): UiNode {
  return (
    <DiffLineList
      lines={unifiedDiffDisplayLines(diff).filter((line) => line.kind !== "file" && !line.text.startsWith("@@"))}
      className="codex-panel-selection-rewrite__diff-body"
    />
  );
}
