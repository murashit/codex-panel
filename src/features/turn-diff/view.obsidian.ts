import { ItemView, type ViewStateResult } from "obsidian";

import { VIEW_TYPE_CODEX_TURN_DIFF } from "../../constants";
import { unmountUiRoot } from "../../shared/dom/preact-root.dom";
import { copyTextWithNotice } from "../../shared/obsidian/clipboard.obsidian";
import { isPersistedTurnDiffViewState, type PersistedTurnDiffViewState, persistedTurnDiffViewState, type TurnDiffViewState } from "./model";
import { renderTurnDiffView } from "./render.dom";

export class CodexTurnDiffView extends ItemView {
  private metadata: PersistedTurnDiffViewState | null = null;
  private payload: TurnDiffViewState | null = null;

  override getViewType(): string {
    return VIEW_TYPE_CODEX_TURN_DIFF;
  }

  override getDisplayText(): string {
    return "Codex turn diff";
  }

  override getIcon(): string {
    return "file-diff";
  }

  override getState(): Record<string, unknown> {
    return this.metadata ? { ...this.metadata } : {};
  }

  override async setState(state: unknown, result: ViewStateResult): Promise<void> {
    await super.setState(state, result);
    this.metadata = isPersistedTurnDiffViewState(state)
      ? {
          threadId: state.threadId,
          turnId: state.turnId,
          files: [...state.files],
        }
      : null;
    this.payload = null;
    this.render();
  }

  override async onOpen(): Promise<void> {
    this.render();
  }

  override async onClose(): Promise<void> {
    unmountUiRoot(this.contentEl);
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
      this.payload ? { copyDiff: () => void this.copyDiff(this.payload?.diff ?? "") } : {},
      this.metadata,
    );
  }

  private async copyDiff(diff: string): Promise<void> {
    await copyTextWithNotice(diff, "Copied diff.", "Could not copy diff.");
  }
}
