import type { AppServerClient } from "../../../app-server/connection/client";
import type { AppServerQueryContext } from "../../../app-server/query/keys";
import type { ChatPanelSnapshot } from "../panel/snapshot";

export interface ChatViewLifecycleSurface {
  displayTitle(): string;
  persistedState(): Record<string, unknown>;
  applyViewState(state: unknown): void;
  open(): void;
  close(): void;
  refreshSettings(): void;
}

export interface ChatWorkspacePanelSurface {
  openPanelSnapshot(): ChatPanelSnapshot;
  openThread(threadId: string): Promise<void>;
  focusThread(threadId?: string | null): Promise<void>;
  hydrateRestoredThread(): Promise<void>;
  focusComposer(): void;
  connect(): Promise<void>;
  startNewThread(): Promise<void>;
}

export interface ChatSharedThreadSurface {
  refreshSharedThreads(): Promise<void>;
  applyThreadArchived(threadId: string): void;
  applyThreadRenamed(threadId: string, name: string | null): void;
}

export interface ChatPanelClientSurface {
  canServeAppServerContext(context: AppServerQueryContext): boolean;
  runWithAppServerClient<T>(operation: (client: AppServerClient) => Promise<T>): Promise<T>;
}

export type ChatSurfaceHandle = ChatViewLifecycleSurface &
  ChatWorkspacePanelSurface &
  ChatSharedThreadSurface &
  ChatPanelClientSurface & {
    setComposerText(text: string): void;
  };
