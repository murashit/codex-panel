import { ItemView } from "obsidian";

import { VIEW_TYPE_CODEX_TURN_DIFF } from "../../constants";
import { unmountUiRoot } from "../../shared/dom/preact-root.dom";
import { copyTextWithNotice } from "../../shared/obsidian/clipboard.obsidian";
import type { TurnDiffViewState } from "./model";
import { renderTurnDiffView } from "./render.dom";

export class CodexTurnDiffView extends ItemView {
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
    return {};
  }

  override async onOpen(): Promise<void> {
    this.render();
  }

  override async onClose(): Promise<void> {
    unmountUiRoot(this.contentEl);
  }

  setDiffPayload(payload: TurnDiffViewState): void {
    this.payload = payload;
    this.render();
  }

  private render(): void {
    const root = this.contentEl;
    renderTurnDiffView(root, this.payload, this.payload ? { copyDiff: () => void this.copyDiff(this.payload?.diff ?? "") } : {});
  }

  private async copyDiff(diff: string): Promise<void> {
    await copyTextWithNotice(diff, "Copied diff.", "Could not copy diff.");
  }
}
