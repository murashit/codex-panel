import { ItemView, type ViewStateResult } from "obsidian";

import { VIEW_TYPE_CODEX_TURN_DIFF } from "../constants";
import { copyTextWithNotice } from "../ui/clipboard";
import {
  isPersistedTurnDiffViewState,
  persistedTurnDiffViewState,
  renderTurnDiffView,
  type PersistedTurnDiffViewState,
  type TurnDiffViewState,
} from "../ui/turn-diff";

export class CodexTurnDiffView extends ItemView {
  private metadata: PersistedTurnDiffViewState | null = null;
  private payload: TurnDiffViewState | null = null;

  getViewType(): string {
    return VIEW_TYPE_CODEX_TURN_DIFF;
  }

  getDisplayText(): string {
    return "Codex turn diff";
  }

  getIcon(): string {
    return "file-diff";
  }

  getState(): Record<string, unknown> {
    return this.metadata ? { ...this.metadata } : {};
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    await super.setState(state, result);
    this.metadata = isPersistedTurnDiffViewState(state)
      ? {
          threadId: state.threadId,
          turnId: state.turnId,
          cwd: state.cwd,
          files: [...state.files],
        }
      : null;
    this.payload = null;
    this.render();
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  setDiffPayload(payload: TurnDiffViewState): void {
    this.metadata = persistedTurnDiffViewState(payload);
    this.payload = payload;
    this.render();
  }

  private render(): void {
    const root = this.contentEl;
    renderTurnDiffView(
      root,
      this.payload,
      {
        copyDiff: this.payload ? () => void this.copyDiff(this.payload?.diff ?? "") : undefined,
      },
      this.metadata,
    );
  }

  private async copyDiff(diff: string): Promise<void> {
    await copyTextWithNotice(diff, "Copied diff.", "Could not copy diff.");
  }
}
