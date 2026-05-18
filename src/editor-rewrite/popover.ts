import { Notice, type Editor } from "obsidian";

import { renderUnifiedDiff } from "../ui/turn-diff";
import { buildSelectionUnifiedDiff } from "./diff";
import { isRewriteGenerateKey } from "./keys";
import { canApplyRewrite, type RewriteRuntimeSettings, type RewriteSession } from "./model";
import { RewriteOutputError } from "./output";
import { buildRewritePrompt } from "./prompt";
import { runRewriteSelection, type RewriteActivity } from "./runner";
import type { SendShortcut } from "../settings/model";

const POPOVER_MARGIN = 8;

export interface RewriteSelectionPopoverOptions {
  codexPath: string;
  cwd: string;
  editor: Editor;
  runtimeSettings: RewriteRuntimeSettings;
  sendShortcut: SendShortcut;
  session: RewriteSession;
}

type Cleanup = () => void;

export class RewriteSelectionPopover {
  private rootEl: HTMLElement | null = null;
  private instructionEl: HTMLTextAreaElement | null = null;
  private generateButton: HTMLButtonElement | null = null;
  private applyButton: HTMLButtonElement | null = null;
  private statusEl: HTMLElement | null = null;
  private diffEl: HTMLElement | null = null;
  private debugEl: HTMLDetailsElement | null = null;
  private readonly cleanups: Cleanup[] = [];

  constructor(private readonly options: RewriteSelectionPopoverOptions) {}

  open(): void {
    this.close();

    const root = activeDocument.body.createDiv({ cls: "codex-panel-rewrite-popover" });
    root.setAttr("role", "dialog");
    root.setAttr("aria-label", "Rewrite selection");
    this.rootEl = root;

    const instructionEl = root.createEl("textarea", {
      cls: "codex-panel-rewrite-popover__instruction",
      attr: { placeholder: "How should Codex rewrite the selected text?" },
    });
    instructionEl.value = this.options.session.instruction;
    instructionEl.oninput = () => this.syncControls();
    instructionEl.onkeydown = (event) => {
      if (!isRewriteGenerateKey(event, this.options.sendShortcut)) return;
      event.preventDefault();
      void this.generate();
    };
    this.instructionEl = instructionEl;

    const controls = root.createDiv({ cls: "codex-panel-rewrite-popover__controls" });
    const generateButton = controls.createEl("button", { text: "Generate", attr: { type: "button" } });
    generateButton.onclick = () => void this.generate();
    this.generateButton = generateButton;
    const cancelButton = controls.createEl("button", { text: "Cancel", attr: { type: "button" } });
    cancelButton.onclick = () => {
      this.options.session.status = "cancelled";
      this.close();
    };

    this.statusEl = root.createDiv({ cls: "codex-panel-rewrite-popover__status" });
    this.diffEl = root.createDiv({ cls: "codex-panel-rewrite-popover__diff" });

    const footer = root.createDiv({ cls: "codex-panel-rewrite-popover__footer" });
    const applyButton = footer.createEl("button", {
      text: "Apply",
      cls: "mod-cta",
      attr: { type: "button" },
    });
    applyButton.onclick = () => this.apply();
    this.applyButton = applyButton;

    this.addDomListener(activeWindow, "resize", () => this.position());
    this.addDomListener(activeWindow, "scroll", () => this.position(), true);
    this.addDomListener(activeDocument, "keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.options.session.status = "cancelled";
        this.close();
      }
    });

    this.setStatus("");
    this.syncControls();
    this.position();
    instructionEl.focus();
  }

  close(): void {
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.rootEl?.remove();
    this.rootEl = null;
    this.instructionEl = null;
    this.generateButton = null;
    this.applyButton = null;
    this.statusEl = null;
    this.diffEl = null;
    this.debugEl = null;
  }

  private async generate(): Promise<void> {
    const instruction = this.instructionEl?.value.trim() ?? "";
    if (!instruction) {
      new Notice("Enter a rewrite instruction first.");
      this.instructionEl?.focus();
      return;
    }

    this.options.session.instruction = instruction;
    this.options.session.status = "generating";
    this.options.session.streamText = "";
    this.options.session.replacementText = null;
    this.options.session.debugText = null;
    this.diffEl?.empty();
    this.debugEl?.remove();
    this.debugEl = null;
    this.renderDebug();
    this.setStatus("Generating", { active: true });
    this.syncControls();

    try {
      const output = await runRewriteSelection({
        codexPath: this.options.codexPath,
        cwd: this.options.cwd,
        prompt: buildRewritePrompt(this.options.session),
        runtimeSettings: this.options.runtimeSettings,
        onActivity: (activity) => this.updateActivity(activity),
        onPreview: (text) => this.updatePreview(text),
      });
      this.options.session.replacementText = output.replacementText;
      this.options.session.status = "preview";
      this.renderDiff();
      this.setStatus("");
    } catch (error) {
      this.options.session.status = "failed";
      this.options.session.debugText = error instanceof RewriteOutputError ? error.rawText : null;
      this.renderDebug();
      this.setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      this.syncControls();
      this.position();
    }
  }

  private updatePreview(text: string): void {
    this.options.session.streamText = text;
    this.setStatus("Writing replacement", { active: true });
    this.position();
  }

  private updateActivity(activity: RewriteActivity): void {
    this.setStatus(activity === "reasoning" ? "Reasoning" : "Writing replacement", { active: true });
  }

  private renderDiff(): void {
    const replacement = this.options.session.replacementText;
    if (replacement === null || !this.diffEl) return;
    this.diffEl.empty();
    renderUnifiedDiff(
      this.diffEl,
      buildSelectionUnifiedDiff(this.options.session.filePath, this.options.session.originalText, replacement),
    );
  }

  private renderDebug(): void {
    const debugText = this.options.session.debugText;
    this.debugEl?.remove();
    this.debugEl = null;
    if (!debugText || !this.rootEl) return;

    const debugEl = this.rootEl.createEl("details", { cls: "codex-panel-rewrite-popover__debug" });
    debugEl.createEl("summary", { text: "Debug output" });
    debugEl.createEl("pre", { text: debugText });
    this.debugEl = debugEl;
  }

  private apply(): void {
    const replacement = this.options.session.replacementText;
    if (replacement === null) return;

    const { editor, session } = this.options;
    const currentText = editor.getRange(session.targetRange.from, session.targetRange.to);
    if (!canApplyRewrite(currentText, session.originalText)) {
      new Notice("Selection changed. Generate the rewrite again before applying.");
      this.setStatus("Selection changed. Generate the rewrite again before applying.");
      return;
    }

    editor.replaceRange(replacement, session.targetRange.from, session.targetRange.to, "codex-panel-rewrite");
    session.status = "applied";
    this.close();
  }

  private setStatus(text: string, options: { active?: boolean } = {}): void {
    if (!this.statusEl) return;
    this.statusEl.empty();
    this.statusEl.classList.toggle("is-active", Boolean(options.active));
    this.statusEl.createSpan({ text });
    if (!options.active) return;
    const dots = this.statusEl.createSpan({ cls: "codex-panel-rewrite-popover__status-dots" });
    dots.createSpan({ text: "." });
    dots.createSpan({ text: "." });
    dots.createSpan({ text: "." });
  }

  private syncControls(): void {
    const generating = this.options.session.status === "generating";
    const hasInstruction = Boolean(this.instructionEl?.value.trim());
    if (this.instructionEl) this.instructionEl.disabled = generating;
    if (this.generateButton) {
      this.generateButton.disabled = generating || !hasInstruction;
      this.generateButton.setText(this.options.session.replacementText === null ? "Generate" : "Regenerate");
    }
    if (this.applyButton) this.applyButton.disabled = generating || this.options.session.replacementText === null;
  }

  private position(): void {
    const root = this.rootEl;
    if (!root || !root.isConnected) return;

    const view = editorViewFromEditor(this.options.editor);
    if (view?.dom instanceof HTMLElement && !view.dom.isConnected) {
      this.close();
      return;
    }

    const anchor = selectionRect() ?? editorCursorRect(this.options.editor) ?? root.ownerDocument.body.getBoundingClientRect();
    const size = root.getBoundingClientRect();
    const viewportWidth = activeWindow.innerWidth;
    const viewportHeight = activeWindow.innerHeight;
    const left = clamp(anchor.left, POPOVER_MARGIN, viewportWidth - size.width - POPOVER_MARGIN);
    const belowTop = anchor.bottom + POPOVER_MARGIN;
    const aboveTop = anchor.top - size.height - POPOVER_MARGIN;
    const top =
      belowTop + size.height <= viewportHeight - POPOVER_MARGIN
        ? belowTop
        : clamp(aboveTop, POPOVER_MARGIN, viewportHeight - size.height - POPOVER_MARGIN);

    root.style.left = `${left}px`;
    root.style.top = `${top}px`;
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
    this.cleanups.push(() => target.removeEventListener(type, callback, options));
  }
}

function selectionRect(): DOMRect | null {
  const selection = activeWindow.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  return rect.width > 0 || rect.height > 0 ? rect : null;
}

function editorCursorRect(editor: Editor): DOMRect | null {
  const view = editorViewFromEditor(editor);
  if (!view) return null;

  const offset = editor.posToOffset(editor.getCursor("to"));
  if (typeof view.coordsAtPos === "function") {
    return view.coordsAtPos(offset, 1) ?? view.coordsAtPos(offset, -1) ?? null;
  }
  return view.dom instanceof HTMLElement ? view.dom.getBoundingClientRect() : null;
}

function editorViewFromEditor(editor: Editor): { coordsAtPos?: (pos: number, side?: -1 | 1) => DOMRect | null; dom?: unknown } | null {
  const candidate = editor as {
    cm?: unknown;
    editor?: { cm?: unknown };
  };
  if (isEditorView(candidate.cm)) return candidate.cm;
  if (isEditorView(candidate.editor?.cm)) return candidate.editor.cm;
  return null;
}

function isEditorView(value: unknown): value is { coordsAtPos?: (pos: number, side?: -1 | 1) => DOMRect | null; dom?: unknown } {
  return Boolean(value && typeof value === "object" && ("coordsAtPos" in value || "dom" in value));
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}
