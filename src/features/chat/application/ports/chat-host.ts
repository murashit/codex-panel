import type { Thread } from "../../../../domain/threads/model";
import type { SharedServerMetadata } from "../../../../domain/server/metadata";
import type { CodexPanelSettings } from "../../../../settings/model";
import type { ChatTurnDiffViewState } from "../../domain/turn-diff";

export interface CodexChatHost {
  readonly settingsRef: PluginSettingsRef;
  readonly workspace: WorkspacePanels;
  readonly threadCatalog: ThreadCatalogFacade;
}

export interface PluginSettingsRef {
  readonly settings: CodexPanelSettings;
  readonly vaultPath: string;
}

export interface WorkspacePanels {
  openThreadInNewView(threadId: string): Promise<unknown>;
  focusThreadInOpenView(threadId: string): Promise<boolean>;
  openTurnDiff(state: ChatTurnDiffViewState): Promise<void>;
}

export interface ThreadCatalogFacade {
  archiveThreadInCatalog(threadId: string): void;
  renameThreadInCatalog(threadId: string, name: string | null): void;
  refreshThreadsViewLiveState(): void;
  refreshFromOpenSurface(): void;
  applyThreads(threads: readonly Thread[]): void;
  publishAppServerMetadata(metadata: SharedServerMetadata): void;
  refreshThreads(fetchThreads: () => Promise<readonly Thread[]>): Promise<readonly Thread[]>;
  cachedThreads(): readonly Thread[] | null;
  cachedAppServerMetadata(): SharedServerMetadata | null;
}
