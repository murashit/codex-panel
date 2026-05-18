import { Modal, Notice, type App, type Editor } from "obsidian";

import { renderUnifiedDiff } from "../ui/turn-diff";
import { buildSelectionUnifiedDiff } from "./diff";
import { canApplyRewrite, type RewriteSession } from "./model";
import { buildRewritePrompt } from "./prompt";
import { runRewriteSelection } from "./runner";

export interface RewriteSelectionModalOptions {
  codexPath: string;
  cwd: string;
  editor: Editor;
  session: RewriteSession;
}

export class RewriteSelectionModal extends Modal {
  private instructionEl: HTMLTextAreaElement | null = null;
  private generateButton: HTMLButtonElement | null = null;
  private applyButton: HTMLButtonElement | null = null;
  private statusEl: HTMLElement | null = null;
  private previewEl: HTMLElement | null = null;
  private diffEl: HTMLElement | null = null;

  constructor(
    app: App,
    private readonly options: RewriteSelectionModalOptions,
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle("Rewrite selection");
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("codex-panel-rewrite");

    this.instructionEl = contentEl.createEl("textarea", {
      cls: "codex-panel-rewrite__instruction",
      attr: { placeholder: "How should Codex rewrite the selected text?" },
    });
    this.instructionEl.value = this.options.session.instruction;
    this.instructionEl.oninput = () => this.syncControls();

    const controls = contentEl.createDiv({ cls: "codex-panel-rewrite__controls" });
    const actions = controls.createDiv({ cls: "codex-panel-rewrite__actions" });
    this.generateButton = actions.createEl("button", { text: "Generate", attr: { type: "button" } });
    this.generateButton.onclick = () => void this.generate();
    const cancelButton = actions.createEl("button", { text: "Cancel", attr: { type: "button" } });
    cancelButton.onclick = () => {
      this.options.session.status = "cancelled";
      this.close();
    };

    this.statusEl = contentEl.createDiv({ cls: "codex-panel-rewrite__status" });
    this.previewEl = contentEl.createEl("pre", { cls: "codex-panel-rewrite__preview" });
    this.diffEl = contentEl.createDiv({ cls: "codex-panel-rewrite__diff" });

    const footer = contentEl.createDiv({ cls: "codex-panel-rewrite__footer" });
    this.applyButton = footer.createEl("button", {
      text: "Apply",
      cls: "mod-cta",
      attr: { type: "button" },
    });
    this.applyButton.onclick = () => this.apply();

    this.setStatus("Enter an instruction, then generate a patch.");
    this.syncControls();
    this.instructionEl.focus();
  }

  onClose(): void {
    this.contentEl.empty();
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
    this.previewEl?.setText("");
    this.diffEl?.empty();
    this.setStatus("Generating patch...");
    this.syncControls();

    try {
      const output = await runRewriteSelection({
        codexPath: this.options.codexPath,
        cwd: this.options.cwd,
        prompt: buildRewritePrompt(this.options.session),
        onPreview: (text) => this.updatePreview(text),
      });
      this.options.session.replacementText = output.replacementText;
      this.options.session.status = "preview";
      this.renderDiff();
      this.setStatus("Review the patch before applying it.");
    } catch (error) {
      this.options.session.status = "failed";
      this.setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      this.syncControls();
    }
  }

  private updatePreview(text: string): void {
    this.options.session.streamText = text;
    this.previewEl?.setText(text);
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

  private apply(): void {
    const replacement = this.options.session.replacementText;
    if (replacement === null) return;

    const { editor, session } = this.options;
    const currentText = editor.getRange(session.targetRange.from, session.targetRange.to);
    if (!canApplyRewrite(currentText, session.originalText)) {
      new Notice("Selection changed. Generate the rewrite again before applying.");
      return;
    }

    editor.replaceRange(replacement, session.targetRange.from, session.targetRange.to, "codex-panel-rewrite");
    session.status = "applied";
    this.close();
  }

  private setStatus(text: string): void {
    this.statusEl?.setText(text);
  }

  private syncControls(): void {
    const generating = this.options.session.status === "generating";
    const hasInstruction = Boolean(this.instructionEl?.value.trim());
    if (this.instructionEl) this.instructionEl.disabled = generating;
    if (this.generateButton) this.generateButton.disabled = generating || !hasInstruction;
    if (this.applyButton) this.applyButton.disabled = generating || this.options.session.replacementText === null;
  }
}
