import type { OpenCodexPanelSnapshot } from "../../../workspace/open-panel-snapshot";

export interface ChatSurfaceHandle {
  displayTitle(): string;
  persistedState(): Record<string, unknown>;
  applyViewState(state: unknown): void;
  open(): void;
  close(): void;
  refreshSettings(): void;
  refreshSharedThreadList(): Promise<void>;
  openPanelSnapshot(): OpenCodexPanelSnapshot;
  openThread(threadId: string): Promise<void>;
  focusThread(threadId?: string | null): Promise<void>;
  focusComposer(): void;
  applyThreadArchived(threadId: string): void;
  applyThreadRenamed(threadId: string, name: string | null): void;
  setComposerText(text: string): void;
  connect(): Promise<void>;
  startNewThread(): Promise<void>;
}
