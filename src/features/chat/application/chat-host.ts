import type { Thread } from "../../../domain/threads/model";
import type { SharedServerMetadata } from "../../../domain/server/metadata";
import type { CodexPanelSettings } from "../../../settings/model";
import type { ChatTurnDiffViewState } from "../domain/turn-diff";

export interface CodexChatHost {
  readonly settings: CodexPanelSettings;
  readonly vaultPath: string;
  openThreadInNewView(threadId: string): Promise<unknown>;
  focusThreadInOpenView(threadId: string): Promise<boolean>;
  openTurnDiff(state: ChatTurnDiffViewState): Promise<void>;
  notifyThreadArchived(threadId: string): void;
  notifyThreadRenamed(threadId: string, name: string | null): void;
  refreshThreadsViewLiveState(): void;
  refreshSharedThreadListFromOpenSurface(): void;
  applyThreadListSnapshot(threads: readonly Thread[]): void;
  refreshThreadList(fetchThreads: () => Promise<readonly Thread[]>): Promise<readonly Thread[]>;
  cachedThreadList(): readonly Thread[] | null;
  publishAppServerMetadata(metadata: SharedServerMetadata): void;
  publishAppServerIdentity(userAgent: string | null): void;
  cachedAppServerMetadata(): SharedServerMetadata | null;
}
