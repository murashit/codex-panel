import { Notice, type Editor } from "obsidian";
import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from "react";

import { renderDisplayDiffLines } from "../../shared/diff/render";
import { displayDiffLines } from "../../shared/diff/unified";
import { IconButton } from "../../shared/ui/react-components";
import { renderReactRoot, unmountReactRoot } from "../../shared/ui/react-root";
import { syncTextareaHeight } from "../../shared/ui/textarea-autogrow";
import { buildSelectionUnifiedDiff } from "./diff";
import { isSelectionRewriteActionKey, isSelectionRewriteGenerateKey } from "./keys";
import {
  canApplySelectionRewrite,
  transitionSelectionRewriteState,
  type SelectionRewriteLifecycleEvent,
  type SelectionRewriteRuntimeSettings,
  type SelectionRewriteState,
} from "./model";
import { SelectionRewriteOutputError } from "./output";
import { positionSelectionRewritePopover } from "./position";
import { buildSelectionRewritePrompt } from "./prompt";
import { runSelectionRewrite, type SelectionRewriteActivity } from "./runner";
import type { SendShortcut } from "../../shared/ui/keyboard";

const POPOVER_MARGIN = 8;

export interface SelectionRewritePopoverOptions {
  codexPath: string;
  cwd: string;
  editor: Editor;
  onClose?: () => void;
  runtimeSettings: SelectionRewriteRuntimeSettings;
  sendShortcut: SendShortcut;
  state: SelectionRewriteState;
}

type Cleanup = () => void;

interface SelectionRewriteElements {
  root: HTMLElement;
  instruction: HTMLTextAreaElement | null;
  applyButton: HTMLButtonElement | null;
}

type SelectionRewriteGenerationRunState = { kind: "idle" } | { kind: "running"; abortController: AbortController };
type ActiveSelectionRewriteGenerationRun = Extract<SelectionRewriteGenerationRunState, { kind: "running" }>;

export class SelectionRewritePopover {
  private elements: SelectionRewriteElements | null = null;
  private generationRun: SelectionRewriteGenerationRunState = { kind: "idle" };
  private readonly cleanups: Cleanup[] = [];
  private instructionDraft: string;
  private statusText = "";
  private statusActive = false;

  constructor(private readonly options: SelectionRewritePopoverOptions) {
    this.instructionDraft = options.state.instruction;
  }

  open(): void {
    this.close();

    const elements = this.createElements();
    this.elements = elements;

    this.addDomListener(activeWindow, "resize", () => {
      this.position();
    });
    this.addDomListener(
      activeWindow,
      "scroll",
      () => {
        this.position();
      },
      true,
    );
    this.addDomListener(activeDocument, "keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.cancel();
      }
    });

    this.setStatus("");
    this.syncInstructionHeight();
    this.syncControls();
    this.position();
    elements.instruction?.focus();
  }

  close(): void {
    const hadElements = this.elements !== null;
    if (!hadElements && this.options.state.status !== "generating") return;
    if (this.options.state.status === "generating") {
      this.abortGeneration();
    }
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    if (this.elements) {
      unmountReactRoot(this.elements.root);
      this.elements.root.remove();
    }
    this.elements = null;
    this.options.onClose?.();
  }

  private async generate(): Promise<void> {
    if (this.generationRun.kind === "running" || this.options.state.status === "generating") return;
    const instruction = this.instructionDraft.trim();
    if (!instruction) {
      new Notice("Enter a rewrite instruction first.");
      this.elements?.instruction?.focus();
      return;
    }

    const generationRun = this.startGeneration(instruction);
    this.setStatus("Generating", { active: true });
    this.syncControls();

    try {
      const output = await runSelectionRewrite({
        codexPath: this.options.codexPath,
        cwd: this.options.cwd,
        prompt: buildSelectionRewritePrompt(this.options.state),
        runtimeSettings: this.options.runtimeSettings,
        onActivity: (activity) => {
          this.updateActivity(activity);
        },
        onPreview: (text) => {
          this.updatePreview(text);
        },
        signal: generationRun.abortController.signal,
      });
      if (generationRun.abortController.signal.aborted || !this.isActiveGenerationRun(generationRun)) return;
      this.showSelectionRewritePreview(output.replacementText);
    } catch (error) {
      if (generationRun.abortController.signal.aborted) {
        this.transitionState({ type: "cancelled" });
        return;
      }
      this.showGenerationFailure(error);
    } finally {
      if (this.isActiveGenerationRun(generationRun)) this.generationRun = { kind: "idle" };
      this.syncControls();
      if (this.options.state.status === "preview") this.focusApplyButton();
      this.position();
    }
  }

  private cancel(): void {
    this.transitionState({ type: "cancelled" });
    this.abortGeneration();
    this.close();
  }

  private updatePreview(text: string): void {
    this.transitionState({ type: "preview-updated", text });
    this.setStatus("Writing replacement", { active: true });
    this.position();
  }

  private updateActivity(activity: SelectionRewriteActivity): void {
    this.setStatus(activity === "reasoning" ? "Reasoning" : "Writing replacement", { active: true });
  }

  private createElements(): SelectionRewriteElements {
    const root = activeDocument.body.createDiv({ cls: "codex-panel-selection-rewrite" });
    root.setAttr("role", "dialog");
    root.setAttr("aria-label", "Rewrite selection");
    const elements: SelectionRewriteElements = { root, instruction: null, applyButton: null };
    this.renderView(elements);
    return elements;
  }

  private startGeneration(instruction: string): ActiveSelectionRewriteGenerationRun {
    const generationRun: ActiveSelectionRewriteGenerationRun = { kind: "running", abortController: new AbortController() };
    this.generationRun = generationRun;
    this.transitionState({ type: "generation-started", instruction });
    this.renderView();
    return generationRun;
  }

  private showSelectionRewritePreview(replacementText: string): void {
    this.transitionState({ type: "generation-succeeded", replacementText });
    this.setStatus("");
  }

  private showGenerationFailure(error: unknown): void {
    this.transitionState({
      type: "generation-failed",
      debugText: error instanceof SelectionRewriteOutputError ? error.rawText : null,
    });
    this.setStatus(error instanceof Error ? error.message : String(error));
  }

  private apply(): void {
    const replacement = this.options.state.replacementText;
    if (replacement === null) return;

    const { editor, state } = this.options;
    const currentText = editor.getRange(state.targetRange.from, state.targetRange.to);
    if (!canApplySelectionRewrite(currentText, state.originalText)) {
      new Notice("Selection changed. Generate the rewrite again before applying.");
      this.setStatus("Selection changed. Generate the rewrite again before applying.");
      return;
    }

    editor.replaceRange(replacement, state.targetRange.from, state.targetRange.to, "codex-panel-rewrite");
    this.transitionState({ type: "applied" });
    this.close();
  }

  private transitionState(event: SelectionRewriteLifecycleEvent): void {
    this.options.state = transitionSelectionRewriteState(this.options.state, event);
  }

  private focusApplyButton(): void {
    if (!this.elements?.applyButton || this.elements.applyButton.disabled) return;
    this.elements.applyButton.focus({ preventScroll: true });
  }

  private setStatus(text: string, options: { active?: boolean } = {}): void {
    this.statusText = text;
    this.statusActive = Boolean(options.active);
    this.renderView();
  }

  private abortGeneration(): void {
    if (this.generationRun.kind === "running") this.generationRun.abortController.abort();
  }

  private isActiveGenerationRun(generationRun: ActiveSelectionRewriteGenerationRun): boolean {
    return this.generationRun.kind === "running" && this.generationRun === generationRun;
  }

  private syncControls(): void {
    this.renderView();
  }

  private syncInstructionHeight(): void {
    const instruction = this.elements?.instruction ?? null;
    syncTextareaHeight(instruction, {
      minHeightFallback: 56,
      maxHeightFallback: instruction ? Math.min(180, instruction.win.innerHeight * 0.3) : 180,
    });
  }

  private position(): void {
    if (!this.elements) return;
    if (!positionSelectionRewritePopover(this.elements.root, this.options.editor, POPOVER_MARGIN)) this.close();
  }

  private renderView(elements: SelectionRewriteElements | null = this.elements): void {
    if (!elements) return;
    const state = this.options.state;
    const replacement = state.replacementText;
    renderReactRoot(
      elements.root,
      <SelectionRewritePopoverView
        applyButtonRef={(element) => {
          elements.applyButton = element;
        }}
        debugText={state.debugText}
        diff={replacement === null ? null : buildSelectionUnifiedDiff(state.filePath, state.originalText, replacement)}
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
        onCancel={() => {
          this.cancel();
        }}
        onGenerate={() => void this.generate()}
        onInstructionInput={(value) => {
          this.instructionDraft = value;
          this.syncInstructionHeight();
          this.syncControls();
          this.position();
        }}
        onInstructionKeyDown={(event) => {
          const hasReplacement = this.options.state.replacementText !== null;
          if (
            !(hasReplacement
              ? isSelectionRewriteActionKey(event.nativeEvent)
              : isSelectionRewriteGenerateKey(event.nativeEvent, this.options.sendShortcut))
          ) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          void this.generate();
        }}
        onApplyKeyDown={(event) => {
          if (!isSelectionRewriteActionKey(event.nativeEvent)) return;
          event.preventDefault();
          this.apply();
        }}
        statusActive={this.statusActive}
        statusText={this.statusText}
        streamPreview={state.streamText.trim()}
      />,
    );
  }

  private addDomListener<K extends keyof WindowEventMap>(
    target: Window,
    type: K,
    callback: (event: WindowEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  private addDomListener<K extends keyof DocumentEventMap>(
    target: Document,
    type: K,
    callback: (event: DocumentEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  private addDomListener(
    target: Window | Document,
    type: string,
    callback: EventListener,
    options?: boolean | AddEventListenerOptions,
  ): void {
    target.addEventListener(type, callback, options);
    this.cleanups.push(() => {
      target.removeEventListener(type, callback, options);
    });
  }
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
  onApplyKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onCancel: () => void;
  onGenerate: () => void;
  onInstructionInput: (value: string) => void;
  onInstructionKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  statusActive: boolean;
  statusText: string;
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
  onCancel,
  onGenerate,
  onInstructionInput,
  onInstructionKeyDown,
  statusActive,
  statusText,
  streamPreview,
}: SelectionRewritePopoverViewProps): ReactNode {
  return (
    <>
      <div className="codex-panel-selection-rewrite__prompt-row">
        <textarea
          ref={instructionRef}
          className="codex-panel-ui__text-input codex-panel-selection-rewrite__instruction"
          disabled={generating}
          onChange={(event) => {
            onInstructionInput(event.currentTarget.value);
          }}
          onKeyDown={onInstructionKeyDown}
          placeholder="How should Codex rewrite this selection?"
          value={instruction}
        />
        <div className="codex-panel-ui__action-stack codex-panel-selection-rewrite__controls">
          <IconButton
            icon="sparkles"
            label={hasReplacement ? "Regenerate" : "Generate"}
            className="clickable-icon codex-panel-ui__icon-button codex-panel-selection-rewrite__icon-button"
            disabled={generating || !hasInstruction}
            onClick={onGenerate}
          />
          <IconButton
            icon="x"
            label="Cancel"
            className="clickable-icon codex-panel-ui__icon-button codex-panel-selection-rewrite__icon-button"
            onClick={onCancel}
          />
        </div>
      </div>
      <SelectionRewriteStatus text={statusText} active={statusActive} />
      <pre className={`codex-panel-selection-rewrite__stream-preview${streamPreview ? "" : " is-hidden"}`}>{streamPreview}</pre>
      <div className={`codex-panel-selection-rewrite__result-row${hasReplacement ? "" : " is-hidden"}`}>
        <div className="codex-panel-selection-rewrite__diff">{diff ? <SelectionRewriteDiff diff={diff} /> : null}</div>
        <IconButton
          buttonRef={applyButtonRef}
          icon="check"
          label="Apply"
          className={`clickable-icon codex-panel-ui__icon-button codex-panel-selection-rewrite__icon-button mod-cta${
            hasReplacement ? "" : " is-hidden"
          }`}
          disabled={generating || !hasReplacement}
          onClick={onApply}
          onKeyDown={onApplyKeyDown}
        />
      </div>
      {debugText ? (
        <details className="codex-panel-selection-rewrite__debug">
          <summary>Debug output</summary>
          <pre>{debugText}</pre>
        </details>
      ) : null}
    </>
  );
}

function SelectionRewriteStatus({ text, active }: { text: string; active: boolean }): ReactNode {
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

function SelectionRewriteDiff({ diff }: { diff: string }): ReactNode {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.replaceChildren();
    renderSelectionRewriteDiff(element, diff);
  }, [diff]);
  return <div ref={ref} />;
}

function renderSelectionRewriteDiff(parent: HTMLElement, diff: string): void {
  renderDisplayDiffLines(
    parent,
    displayDiffLines(diff).filter((line) => line.kind !== "file" && !line.text.startsWith("@@")),
    { className: "codex-panel-selection-rewrite__diff-body" },
  );
}
