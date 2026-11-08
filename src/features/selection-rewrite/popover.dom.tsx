import { type Editor, Notice } from "obsidian";
import type { TargetedKeyboardEvent, ComponentChild as UiNode } from "preact";
import { isComposerSendKey, type SendShortcut } from "../../domain/input/send-shortcut";
import { type DiffDisplayLine, DiffLineList } from "../../shared/ui/diff-view";
import { retainEditorSelectionEmphasis, type SelectionEmphasis } from "../../shared/ui/editor-selection-emphasis.obsidian";
import { listenDomEscapeKey, listenDomEvent, listenOutsideDomEvent } from "../../shared/ui/events.dom";
import { IconButton } from "../../shared/ui/icon.dom";
import { unmountUiRoot } from "../../shared/ui/preact-root.dom";
import { renderObsidianUiRoot } from "../../shared/ui/preact-root.obsidian";
import { syncTextareaHeight } from "../../shared/ui/textarea-autogrow.measure";
import { textareaCursorAtVisualBoundary } from "../../shared/ui/textarea-caret.measure";
import { buildSelectionDiffLines } from "./diff";
import type { SelectionRewriteInput, SelectionRewriteRuntimeSettings } from "./model";
import { SelectionRewriteOutputError, type SelectionRewritePort } from "./port";
import { positionSelectionRewritePopover } from "./position.dom";
import { buildSelectionRewritePrompt } from "./prompt";

type SelectionRewriteInstructionHistoryDirection = -1 | 1;

type SelectionRewriteState = Readonly<
  | {
      status: "editing";
      streamText: string;
      replacementText: null;
      debugText: null;
    }
  | {
      status: "generating";
      streamText: string;
      replacementText: null;
      debugText: null;
    }
  | {
      status: "preview";
      streamText: "";
      replacementText: string;
      debugText: null;
    }
  | {
      status: "failed";
      streamText: "";
      replacementText: null;
      debugText: string | null;
    }
>;

const POPOVER_MARGIN = 8;
const MAX_INSTRUCTION_HISTORY = 20;
const instructionHistory: string[] = [];

interface RewriteStatus {
  text: string;
  active: boolean;
}

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
  runtimeSettings: SelectionRewriteRuntimeSettings;
  sendShortcut: SendShortcut;
  input: SelectionRewriteInput;
  port: SelectionRewritePort;
  viewDocument: Document;
  viewWindow: Window;
}

type Cleanup = () => void;

interface SelectionRewriteElements {
  root: HTMLElement;
  instruction: HTMLTextAreaElement | null;
  applyButton: HTMLButtonElement | null;
}

export interface SelectionRewritePopoverHandle {
  close(): void;
}

export function openSelectionRewritePopover(options: SelectionRewritePopoverOptions): SelectionRewritePopoverHandle {
  let popover: SelectionRewritePopover | null = new SelectionRewritePopover(options, () => {
    popover = null;
  });
  popover.open();
  return { close: () => popover?.close() };
}

class SelectionRewritePopover {
  private readonly lifetime = new AbortController();
  private selectionEmphasis: SelectionEmphasis | null = null;
  private elements: SelectionRewriteElements | null = null;
  private readonly cleanups: Cleanup[] = [];
  private historyCursor: number | null = null;
  private historyDraft = "";
  private instructionDraft = "";
  private status: RewriteStatus = { text: "", active: false };
  private state: SelectionRewriteState = {
    status: "editing",
    streamText: "",
    replacementText: null,
    debugText: null,
  };

  constructor(
    private readonly options: SelectionRewritePopoverOptions,
    private readonly onClose: () => void,
  ) {}

  open(): void {
    this.selectionEmphasis = retainEditorSelectionEmphasis(this.options.editor, this.options.input.targetRange);
    const elements = this.createElements();
    this.elements = elements;

    this.cleanups.push(
      listenDomEvent(this.options.viewWindow, "resize", () => {
        this.position();
      }),
    );
    this.cleanups.push(
      listenDomEvent(
        this.options.viewWindow,
        "scroll",
        () => {
          this.position();
        },
        true,
      ),
    );
    this.cleanups.push(
      listenDomEscapeKey(this.options.viewDocument, (event) => {
        event.preventDefault();
        this.close();
      }),
    );
    this.cleanups.push(
      listenOutsideDomEvent(
        elements.root,
        "pointerdown",
        () => {
          this.close();
        },
        true,
      ),
    );

    this.syncInstructionHeight();
    this.renderView();
    this.position();
    if (!this.isClosed()) elements.instruction?.focus();
  }

  close(): void {
    if (this.isClosed()) return;
    this.lifetime.abort();
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    if (this.elements) {
      unmountUiRoot(this.elements.root);
      this.elements.root.remove();
    }
    this.elements = null;
    this.selectionEmphasis?.release();
    this.onClose();
  }

  private isClosed(): boolean {
    return this.lifetime.signal.aborted;
  }

  private async generate(): Promise<void> {
    const signal = this.lifetime.signal;
    if (this.isClosed() || this.state.status === "generating") return;
    const instruction = this.instructionDraft.trim();
    if (!instruction) {
      new Notice("Enter a rewrite instruction first.");
      this.elements?.instruction?.focus();
      return;
    }

    rememberInstruction(instruction);
    this.historyCursor = null;
    this.historyDraft = "";
    this.state = { status: "generating", streamText: "", replacementText: null, debugText: null };
    this.status = { text: "Generating", active: true };
    this.renderView();

    try {
      const output = await this.options.port.generate({
        prompt: buildSelectionRewritePrompt(this.options.input, instruction),
        runtimeSettings: this.options.runtimeSettings,
        onActivity: (activity) => {
          if (this.isClosed()) return;
          this.status = { text: activity === "reasoning" ? "Reasoning" : "Writing replacement", active: true };
          this.renderView();
        },
        onPreview: (text) => {
          if (this.isClosed()) return;
          this.state = { status: "generating", streamText: text, replacementText: null, debugText: null };
          this.status = { text: "Writing replacement", active: true };
          this.renderView();
          this.position();
        },
        signal,
      });
      if (this.isClosed()) return;
      this.state = { status: "preview", streamText: "", replacementText: output.replacementText, debugText: null };
      this.status = { text: "", active: false };
    } catch (error) {
      if (this.isClosed()) return;
      this.state = {
        status: "failed",
        streamText: "",
        replacementText: null,
        debugText: error instanceof SelectionRewriteOutputError ? error.rawText : null,
      };
      this.status = { text: error instanceof Error ? error.message : String(error), active: false };
    }
    if (this.isClosed()) return;
    this.renderView();
    if (this.state.status === "preview") this.focusApplyButton();
    this.position();
  }

  private createElements(): SelectionRewriteElements {
    const root = this.options.viewDocument.body.createDiv({ cls: "codex-panel-selection-rewrite" });
    root.setAttr("role", "dialog");
    const elements: SelectionRewriteElements = { root, instruction: null, applyButton: null };
    this.renderView(elements);
    return elements;
  }

  private apply(): void {
    const replacement = this.state.replacementText;
    if (replacement === null) return;

    const { editor } = this.options;
    const input = this.options.input;
    const currentText = editor.getRange(input.targetRange.from, input.targetRange.to);
    if (currentText !== input.originalText) {
      const message = "Selection changed. Select the text again and reopen Rewrite selection.";
      new Notice(message);
      this.status = { text: message, active: false };
      this.renderView();
      return;
    }

    editor.replaceRange(replacement, input.targetRange.from, input.targetRange.to, "codex-panel-rewrite");
    this.close();
  }

  private focusApplyButton(): void {
    if (!this.elements?.applyButton || this.elements.applyButton.disabled) return;
    this.elements.applyButton.focus({ preventScroll: true });
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
    const state = this.state;
    const replacement = state.replacementText;
    renderObsidianUiRoot(
      elements.root,
      <SelectionRewritePopoverView
        applyButtonRef={(element) => {
          elements.applyButton = element;
        }}
        debugText={state.debugText}
        diffLines={replacement === null ? null : buildSelectionDiffLines(this.options.input.originalText, replacement)}
        generating={state.status === "generating"}
        hasInstruction={Boolean(this.instructionDraft.trim())}
        hasReplacement={replacement !== null}
        instruction={this.instructionDraft}
        instructionRef={(element) => {
          elements.instruction = element;
        }}
        onApply={() => {
          this.apply();
        }}
        onGenerate={() => void this.generate()}
        onInstructionInput={(value) => {
          this.instructionDraft = value;
          this.historyDraft = this.historyCursor === null ? "" : value;
          this.syncInstructionHeight();
          this.renderView();
          this.position();
        }}
        onInstructionKeyDown={(event) => {
          if (this.handleInstructionHistoryKeyDown(event.currentTarget, event)) return;
          const hasReplacement = this.state.replacementText !== null;
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
        status={this.status}
        streamPreview={state.streamText.trim()}
      />,
    );
  }

  private handleInstructionHistoryKeyDown(instruction: HTMLTextAreaElement, event: TargetedKeyboardEvent<HTMLTextAreaElement>): boolean {
    const direction = selectionRewriteInstructionHistoryDirection(event, instruction);
    if (direction === null || !this.navigateInstructionHistory(direction)) return false;

    event.preventDefault();
    event.stopPropagation();
    this.syncInstructionHeight();
    this.renderView();
    this.position();
    this.focusInstructionEnd();
    return true;
  }

  private navigateInstructionHistory(direction: SelectionRewriteInstructionHistoryDirection): boolean {
    if (instructionHistory.length === 0) return false;

    if (this.historyCursor === null) {
      if (direction === 1) return false;
      this.historyCursor = instructionHistory.length;
      this.historyDraft = this.instructionDraft;
    }

    if (direction === -1 && this.historyCursor > 0) {
      this.historyCursor -= 1;
      this.instructionDraft = instructionHistory[this.historyCursor] ?? "";
      return true;
    }

    if (direction === 1) {
      if (this.historyCursor < instructionHistory.length - 1) {
        this.historyCursor += 1;
        this.instructionDraft = instructionHistory[this.historyCursor] ?? "";
        return true;
      }

      this.historyCursor = null;
      this.instructionDraft = this.historyDraft;
      this.historyDraft = "";
      return true;
    }

    return false;
  }

  private focusInstructionEnd(): void {
    const instruction = this.elements?.instruction;
    if (!instruction) return;
    const cursor = instruction.value.length;
    instruction.focus({ preventScroll: true });
    instruction.setSelectionRange(cursor, cursor);
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
  diffLines: readonly DiffDisplayLine[] | null;
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
  status: RewriteStatus;
  streamPreview: string;
}

function SelectionRewritePopoverView({
  applyButtonRef,
  debugText,
  diffLines,
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
        <div className="codex-panel-ui__text-input-frame codex-panel-selection-rewrite__composer-frame">
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
        <div className="codex-panel-selection-rewrite__diff">
          {diffLines ? <DiffLineList lines={diffLines} className="codex-panel-selection-rewrite__diff-body" /> : null}
        </div>
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

function SelectionRewriteStatus({ status }: { status: RewriteStatus }): UiNode {
  const { text, active } = status;
  if (!text && !active) return <div className="codex-panel-selection-rewrite__status" />;
  return (
    <div className={`codex-panel-selection-rewrite__status${active ? " is-active" : ""}`}>
      <span>{text}</span>
      {active ? (
        <span className="codex-panel-ui__activity-dots">
          <span>.</span>
          <span>.</span>
          <span>.</span>
        </span>
      ) : null}
    </div>
  );
}

function rememberInstruction(instruction: string): void {
  const existingIndex = instructionHistory.indexOf(instruction);
  if (existingIndex !== -1) instructionHistory.splice(existingIndex, 1);
  instructionHistory.push(instruction);
  if (instructionHistory.length > MAX_INSTRUCTION_HISTORY) {
    instructionHistory.splice(0, instructionHistory.length - MAX_INSTRUCTION_HISTORY);
  }
}
