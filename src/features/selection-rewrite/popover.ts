import { Notice, type Editor } from "obsidian";

import { diffLineClass, displayDiffLineText, displayDiffLines } from "../../shared/diff/unified";
import { createIconButton } from "../../shared/ui/components";
import { syncTextareaHeight } from "../../shared/ui/textarea-autogrow";
import { buildSelectionUnifiedDiff } from "./diff";
import { isSelectionRewriteActionKey, isSelectionRewriteGenerateKey } from "./keys";
import { canApplySelectionRewrite, type SelectionRewriteRuntimeSettings, type SelectionRewriteSession } from "./model";
import { SelectionRewriteOutputError } from "./output";
import { positionSelectionRewritePopover } from "./position";
import { buildSelectionRewritePrompt } from "./prompt";
import { runSelectionRewrite, type SelectionRewriteActivity } from "./runner";
import type { SendShortcut } from "../../settings/model";

const POPOVER_MARGIN = 8;

export interface SelectionRewritePopoverOptions {
  codexPath: string;
  cwd: string;
  editor: Editor;
  onClose?: () => void;
  runtimeSettings: SelectionRewriteRuntimeSettings;
  sendShortcut: SendShortcut;
  session: SelectionRewriteSession;
}

type Cleanup = () => void;

interface SelectionRewriteElements {
  root: HTMLElement;
  instruction: HTMLTextAreaElement;
  generateButton: HTMLButtonElement;
  applyButton: HTMLButtonElement;
  resultRow: HTMLElement;
  status: HTMLElement;
  streamPreview: HTMLElement;
  diff: HTMLElement;
  debug: HTMLDetailsElement | null;
}

export class SelectionRewritePopover {
  private elements: SelectionRewriteElements | null = null;
  private abortController: AbortController | null = null;
  private readonly cleanups: Cleanup[] = [];

  constructor(private readonly options: SelectionRewritePopoverOptions) {}

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
    elements.instruction.focus();
  }

  close(): void {
    const hadElements = this.elements !== null;
    if (!hadElements && this.options.session.status !== "generating") return;
    if (this.options.session.status === "generating") {
      this.abortController?.abort();
    }
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.elements?.root.remove();
    this.elements = null;
    this.options.onClose?.();
  }

  private async generate(): Promise<void> {
    if (this.options.session.status === "generating") return;
    const instruction = this.elements?.instruction.value.trim() ?? "";
    if (!instruction) {
      new Notice("Enter a rewrite instruction first.");
      this.elements?.instruction.focus();
      return;
    }

    this.startGeneration(instruction);
    this.setStatus("Generating", { active: true });
    this.syncControls();
    const abortController = new AbortController();
    this.abortController = abortController;

    try {
      const output = await runSelectionRewrite({
        codexPath: this.options.codexPath,
        cwd: this.options.cwd,
        prompt: buildSelectionRewritePrompt(this.options.session),
        runtimeSettings: this.options.runtimeSettings,
        onActivity: (activity) => {
          this.updateActivity(activity);
        },
        onPreview: (text) => {
          this.updatePreview(text);
        },
        signal: abortController.signal,
      });
      if (abortController.signal.aborted) return;
      this.showSelectionRewritePreview(output.replacementText);
    } catch (error) {
      if (abortController.signal.aborted) {
        this.options.session.status = "cancelled";
        return;
      }
      this.showGenerationFailure(error);
    } finally {
      if (this.abortController === abortController) this.abortController = null;
      this.syncControls();
      if (this.options.session.status === "preview") this.focusApplyButton();
      this.position();
    }
  }

  private cancel(): void {
    this.options.session.status = "cancelled";
    this.abortController?.abort();
    this.close();
  }

  private updatePreview(text: string): void {
    this.options.session.streamText = text;
    this.renderStreamPreview();
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

    const instruction = root.createEl("textarea", {
      cls: "codex-panel-ui__text-input codex-panel-selection-rewrite__instruction",
      attr: { placeholder: "How should Codex rewrite this selection?" },
    });
    instruction.value = this.options.session.instruction;
    instruction.oninput = () => {
      this.syncInstructionHeight();
      this.syncControls();
      this.position();
    };
    instruction.onkeydown = (event) => {
      const hasReplacement = this.options.session.replacementText !== null;
      if (!(hasReplacement ? isSelectionRewriteActionKey(event) : isSelectionRewriteGenerateKey(event, this.options.sendShortcut))) return;
      event.preventDefault();
      event.stopPropagation();
      void this.generate();
    };

    const promptRow = root.createDiv({ cls: "codex-panel-selection-rewrite__prompt-row" });
    promptRow.append(instruction);
    const controls = promptRow.createDiv({ cls: "codex-panel-ui__action-stack codex-panel-selection-rewrite__controls" });
    const generateButton = createIconButton(
      controls,
      "sparkles",
      "Generate",
      "codex-panel-ui__icon-button codex-panel-selection-rewrite__icon-button",
    );
    generateButton.onclick = () => void this.generate();
    const cancelButton = createIconButton(
      controls,
      "x",
      "Cancel",
      "codex-panel-ui__icon-button codex-panel-selection-rewrite__icon-button",
    );
    cancelButton.onclick = () => {
      this.cancel();
    };

    const status = root.createDiv({ cls: "codex-panel-selection-rewrite__status" });
    const streamPreview = root.createEl("pre", { cls: "codex-panel-selection-rewrite__stream-preview is-hidden" });
    const resultRow = root.createDiv({ cls: "codex-panel-selection-rewrite__result-row" });
    const diff = resultRow.createDiv({ cls: "codex-panel-selection-rewrite__diff" });
    const applyButton = createIconButton(
      resultRow,
      "check",
      "Apply",
      "codex-panel-ui__icon-button codex-panel-selection-rewrite__icon-button mod-cta",
    );
    applyButton.onclick = () => {
      this.apply();
    };
    applyButton.onkeydown = (event) => {
      if (!isSelectionRewriteActionKey(event)) return;
      event.preventDefault();
      this.apply();
    };

    return { root, instruction, generateButton, applyButton, resultRow, status, streamPreview, diff, debug: null };
  }

  private startGeneration(instruction: string): void {
    this.options.session.instruction = instruction;
    this.options.session.status = "generating";
    this.options.session.streamText = "";
    this.options.session.replacementText = null;
    this.options.session.debugText = null;
    this.elements?.diff.empty();
    this.renderStreamPreview();
    this.renderDebug(null);
  }

  private showSelectionRewritePreview(replacementText: string): void {
    this.options.session.replacementText = replacementText;
    this.options.session.status = "preview";
    this.options.session.streamText = "";
    this.renderStreamPreview();
    this.renderDiff();
    this.setStatus("");
  }

  private showGenerationFailure(error: unknown): void {
    this.options.session.status = "failed";
    this.options.session.debugText = error instanceof SelectionRewriteOutputError ? error.rawText : null;
    this.options.session.streamText = "";
    this.renderStreamPreview();
    this.renderDebug(this.options.session.debugText);
    this.setStatus(error instanceof Error ? error.message : String(error));
  }

  private renderStreamPreview(): void {
    if (!this.elements) return;
    const preview = this.options.session.streamText.trim();
    this.elements.streamPreview.empty();
    this.elements.streamPreview.classList.toggle("is-hidden", !preview);
    if (preview) this.elements.streamPreview.createSpan({ text: preview });
  }

  private renderDiff(): void {
    const replacement = this.options.session.replacementText;
    if (replacement === null || !this.elements) return;
    this.elements.diff.empty();
    renderSelectionRewriteDiff(
      this.elements.diff,
      buildSelectionUnifiedDiff(this.options.session.filePath, this.options.session.originalText, replacement),
    );
  }

  private renderDebug(debugText: string | null): void {
    if (!this.elements) return;
    this.elements.debug?.remove();
    this.elements.debug = null;
    if (!debugText) return;

    const debugEl = this.elements.root.createEl("details", { cls: "codex-panel-selection-rewrite__debug" });
    debugEl.createEl("summary", { text: "Debug output" });
    debugEl.createEl("pre", { text: debugText });
    this.elements.debug = debugEl;
  }

  private apply(): void {
    const replacement = this.options.session.replacementText;
    if (replacement === null) return;

    const { editor, session } = this.options;
    const currentText = editor.getRange(session.targetRange.from, session.targetRange.to);
    if (!canApplySelectionRewrite(currentText, session.originalText)) {
      new Notice("Selection changed. Generate the rewrite again before applying.");
      this.setStatus("Selection changed. Generate the rewrite again before applying.");
      return;
    }

    editor.replaceRange(replacement, session.targetRange.from, session.targetRange.to, "codex-panel-rewrite");
    session.status = "applied";
    this.close();
  }

  private focusApplyButton(): void {
    if (!this.elements || this.elements.applyButton.disabled) return;
    this.elements.applyButton.focus({ preventScroll: true });
  }

  private setStatus(text: string, options: { active?: boolean } = {}): void {
    if (!this.elements) return;
    const { status } = this.elements;
    status.empty();
    status.classList.toggle("is-active", Boolean(options.active));
    if (!text && !options.active) return;
    status.createSpan({ text });
    if (!options.active) return;
    const dots = status.createSpan({ cls: "codex-panel-selection-rewrite__status-dots" });
    dots.createSpan({ text: "." });
    dots.createSpan({ text: "." });
    dots.createSpan({ text: "." });
  }

  private syncControls(): void {
    if (!this.elements) return;
    const generating = this.options.session.status === "generating";
    const hasInstruction = Boolean(this.elements.instruction.value.trim());
    const hasReplacement = this.options.session.replacementText !== null;
    this.elements.instruction.disabled = generating;
    this.elements.generateButton.disabled = generating || !hasInstruction;
    this.elements.generateButton.setAttr("aria-label", hasReplacement ? "Regenerate" : "Generate");
    this.elements.applyButton.disabled = generating || !hasReplacement;
    this.elements.applyButton.classList.toggle("is-hidden", !hasReplacement);
    this.elements.resultRow.classList.toggle("is-hidden", !hasReplacement);
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

function renderSelectionRewriteDiff(parent: HTMLElement, diff: string): void {
  const pre = parent.createEl("pre", { cls: "codex-panel-diff codex-panel-selection-rewrite__diff-body" });
  for (const line of displayDiffLines(diff)) {
    if (line.kind === "file" || line.text.startsWith("@@")) continue;
    const lineClass = diffLineClass(line);
    pre.createEl("span", {
      cls: `codex-panel-diff__line codex-panel-diff__line--${lineClass}`,
      text: displayDiffLineText(line.text, lineClass),
    });
  }
}
