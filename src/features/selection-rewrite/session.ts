import {
  type SelectionRewriteInstructionHistoryDirection,
  type SelectionRewriteLifecycleEvent,
  type SelectionRewriteRuntimeSettings,
  type SelectionRewriteState,
  transitionSelectionRewriteState,
} from "./model";
import { SelectionRewriteOutputError } from "./output";
import { buildSelectionRewritePrompt } from "./prompt";
import { runSelectionRewrite, type SelectionRewriteActivity } from "./runner";

const MAX_SELECTION_REWRITE_INSTRUCTION_HISTORY = 20;

const selectionRewriteInstructionHistory: string[] = [];

type SelectionRewriteGenerationRunState = { kind: "idle" } | { kind: "running"; abortController: AbortController };
type ActiveSelectionRewriteGenerationRun = Extract<SelectionRewriteGenerationRunState, { kind: "running" }>;

export interface SelectionRewriteSessionOptions {
  codexPath: string;
  cwd: string;
  runtimeSettings: SelectionRewriteRuntimeSettings;
  state: SelectionRewriteState;
}

export interface SelectionRewriteSessionStatus {
  text: string;
  active: boolean;
}

export interface SelectionRewriteSessionRenderHooks {
  render(): void;
  position(): void;
  focusApplyButton(): void;
}

export type SelectionRewriteGenerateResult = "started" | "missing-instruction" | "already-running";

export class SelectionRewriteSession {
  private generationRun: SelectionRewriteGenerationRunState = { kind: "idle" };
  private historyCursor: number | null = null;
  private historyDraft = "";
  private statusState: SelectionRewriteSessionStatus = { text: "", active: false };
  private instructionDraftValue: string;

  constructor(private readonly options: SelectionRewriteSessionOptions) {
    this.instructionDraftValue = options.state.instruction;
  }

  get state(): SelectionRewriteState {
    return this.options.state;
  }

  get instructionDraft(): string {
    return this.instructionDraftValue;
  }

  get status(): SelectionRewriteSessionStatus {
    return this.statusState;
  }

  get isGenerating(): boolean {
    return this.generationRun.kind === "running" || this.state.status === "generating";
  }

  get hasInstruction(): boolean {
    return Boolean(this.instructionDraftValue.trim());
  }

  setInstructionDraft(value: string): void {
    this.instructionDraftValue = value;
    if (this.historyCursor === null) {
      this.historyDraft = "";
    } else {
      this.historyDraft = value;
    }
  }

  setStatus(text: string, options: { active?: boolean } = {}): void {
    this.statusState = { text, active: Boolean(options.active) };
  }

  async generate(hooks: SelectionRewriteSessionRenderHooks): Promise<SelectionRewriteGenerateResult> {
    if (this.isGenerating) return "already-running";
    const instruction = this.instructionDraftValue.trim();
    if (!instruction) return "missing-instruction";

    const generationRun = this.startGeneration(instruction);
    this.setStatus("Generating", { active: true });
    hooks.render();

    try {
      const output = await runSelectionRewrite({
        codexPath: this.options.codexPath,
        cwd: this.options.cwd,
        prompt: buildSelectionRewritePrompt(this.state),
        runtimeSettings: this.options.runtimeSettings,
        onActivity: (activity) => {
          if (!this.isActiveGenerationRun(generationRun)) return;
          this.updateActivity(activity);
          hooks.render();
        },
        onPreview: (text) => {
          if (!this.isActiveGenerationRun(generationRun)) return;
          this.updatePreview(text);
          hooks.render();
          hooks.position();
        },
        signal: generationRun.abortController.signal,
      });
      if (!this.isActiveGenerationRun(generationRun)) return "started";
      this.showPreview(output.replacementText);
      hooks.render();
    } catch (error) {
      if (generationRun.abortController.signal.aborted) {
        this.transitionState({ type: "cancelled" });
        return "started";
      }
      this.showGenerationFailure(error);
      hooks.render();
    } finally {
      if (this.isActiveGenerationRun(generationRun)) this.generationRun = { kind: "idle" };
      hooks.render();
      if (this.state.status === "preview") hooks.focusApplyButton();
      hooks.position();
    }

    return "started";
  }

  cancel(): void {
    this.transitionState({ type: "cancelled" });
    this.abortGeneration();
  }

  apply(): void {
    this.transitionState({ type: "applied" });
  }

  abortGeneration(): void {
    if (this.generationRun.kind === "running") this.generationRun.abortController.abort();
  }

  navigateInstructionHistory(direction: SelectionRewriteInstructionHistoryDirection): boolean {
    if (selectionRewriteInstructionHistory.length === 0) return false;

    if (this.historyCursor === null) {
      if (direction === 1) return false;
      this.historyCursor = selectionRewriteInstructionHistory.length;
      this.historyDraft = this.instructionDraftValue;
    }

    if (direction === -1 && this.historyCursor > 0) {
      this.historyCursor -= 1;
      this.instructionDraftValue = selectionRewriteInstructionHistory[this.historyCursor] ?? "";
      return true;
    }

    if (direction === 1) {
      if (this.historyCursor < selectionRewriteInstructionHistory.length - 1) {
        this.historyCursor += 1;
        this.instructionDraftValue = selectionRewriteInstructionHistory[this.historyCursor] ?? "";
        return true;
      }

      this.historyCursor = null;
      this.instructionDraftValue = this.historyDraft;
      this.historyDraft = "";
      return true;
    }

    return false;
  }

  private startGeneration(instruction: string): ActiveSelectionRewriteGenerationRun {
    const generationRun: ActiveSelectionRewriteGenerationRun = { kind: "running", abortController: new AbortController() };
    this.generationRun = generationRun;
    rememberSelectionRewriteInstruction(instruction);
    this.historyCursor = null;
    this.historyDraft = "";
    this.transitionState({ type: "generation-started", instruction });
    return generationRun;
  }

  private updatePreview(text: string): void {
    this.transitionState({ type: "preview-updated", text });
    this.setStatus("Writing replacement", { active: true });
  }

  private updateActivity(activity: SelectionRewriteActivity): void {
    this.setStatus(activity === "reasoning" ? "Reasoning" : "Writing replacement", { active: true });
  }

  private showPreview(replacementText: string): void {
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

  private transitionState(event: SelectionRewriteLifecycleEvent): void {
    this.options.state = transitionSelectionRewriteState(this.options.state, event);
  }

  private isActiveGenerationRun(generationRun: ActiveSelectionRewriteGenerationRun): boolean {
    return !generationRun.abortController.signal.aborted && this.generationRun.kind === "running" && this.generationRun === generationRun;
  }
}

function rememberSelectionRewriteInstruction(instruction: string): void {
  const existingIndex = selectionRewriteInstructionHistory.indexOf(instruction);
  if (existingIndex !== -1) selectionRewriteInstructionHistory.splice(existingIndex, 1);

  selectionRewriteInstructionHistory.push(instruction);
  if (selectionRewriteInstructionHistory.length > MAX_SELECTION_REWRITE_INSTRUCTION_HISTORY) {
    selectionRewriteInstructionHistory.splice(0, selectionRewriteInstructionHistory.length - MAX_SELECTION_REWRITE_INSTRUCTION_HISTORY);
  }
}
