import { ItemView, type ViewStateResult } from "obsidian";

import { VIEW_TYPE_CODEX_TURN_DIFF } from "../../constants";
import { copyTextWithNotice } from "../../shared/ui/clipboard";
import { unmountReactRoot } from "../../shared/ui/react-root";
import {
  isPersistedChatTurnDiffViewState,
  persistedChatTurnDiffViewState,
  renderChatTurnDiffView,
  type PersistedChatTurnDiffViewState,
  type ChatTurnDiffViewState,
} from "./ui/turn-diff";

export class CodexChatTurnDiffView extends ItemView {
  private metadata: PersistedChatTurnDiffViewState | null = null;
  private payload: ChatTurnDiffViewState | null = null;

  override getViewType(): string {
    return VIEW_TYPE_CODEX_TURN_DIFF;
  }

  override getDisplayText(): string {
    return "Codex chat turn diff";
  }

  override getIcon(): string {
    return "file-diff";
  }

  override getState(): Record<string, unknown> {
    return this.metadata ? { ...this.metadata } : {};
  }

  override async setState(state: unknown, result: ViewStateResult): Promise<void> {
    await super.setState(state, result);
    this.metadata = isPersistedChatTurnDiffViewState(state)
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

  override async onOpen(): Promise<void> {
    this.render();
  }

  override async onClose(): Promise<void> {
    unmountReactRoot(this.contentEl);
  }

  setDiffPayload(payload: ChatTurnDiffViewState): void {
    this.metadata = persistedChatTurnDiffViewState(payload);
    this.payload = payload;
    this.render();
  }

  private render(): void {
    const root = this.contentEl;
    renderChatTurnDiffView(
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
