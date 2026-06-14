import type { Thread } from "../../../../domain/threads/model";
import type { SharedServerMetadata } from "../../../../domain/server/metadata";
import type { CodexPanelSettings } from "../../../../settings/model";
import type { ChatTurnDiffViewState } from "../../domain/turn-diff";

export interface CodexChatHost {
  readonly settingsRef: PluginSettingsRef;
  readonly workspace: WorkspacePanels;
  readonly sharedCache: SharedAppServerCacheFacade;
  readonly threadSurfaces: ThreadSurfaceBroadcaster;
  readonly appServerIdentity: AppServerIdentityPublisher;
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

export interface ThreadSurfaceBroadcaster {
  notifyThreadArchived(threadId: string): void;
  notifyThreadRenamed(threadId: string, name: string | null): void;
  refreshThreadsViewLiveState(): void;
  refreshSharedThreadListFromOpenSurface(): void;
  applyThreadListSnapshot(threads: readonly Thread[]): void;
  publishAppServerMetadata(metadata: SharedServerMetadata): void;
}

interface SharedAppServerCacheFacade {
  refreshThreadList(fetchThreads: () => Promise<readonly Thread[]>): Promise<readonly Thread[]>;
  cachedThreadList(): readonly Thread[] | null;
  cachedAppServerMetadata(): SharedServerMetadata | null;
}

interface AppServerIdentityPublisher {
  publishAppServerIdentity(userAgent: string | null): void;
}
