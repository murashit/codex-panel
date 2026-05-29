import type { Thread } from "../../generated/app-server/v2/Thread";
import type { SharedAppServerMetadata } from "../../runtime/shared-app-server-state";
import type { CodexPanelSettings } from "../../settings/model";
import type { ChatTurnDiffViewState } from "./ui/turn-diff";

export interface CodexChatHost {
  readonly settings: CodexPanelSettings;
  readonly vaultPath: string;
  openThreadInNewView(threadId: string): Promise<unknown>;
  openThreadInAvailableView(threadId: string): Promise<void>;
  focusThreadInOpenView(threadId: string): Promise<boolean>;
  openTurnDiff(state: ChatTurnDiffViewState): Promise<void>;
  notifyThreadArchived(threadId: string): void;
  notifyThreadRenamed(threadId: string, name: string | null): void;
  refreshThreadsViewLiveState(): void;
  refreshSharedThreadListFromOpenSurface(): void;
  applyThreadListSnapshot(threads: readonly Thread[]): void;
  refreshThreadList(fetchThreads: () => Promise<readonly Thread[]>): Promise<readonly Thread[]>;
  cachedThreadList(): readonly Thread[] | null;
  publishAppServerMetadata(metadata: SharedAppServerMetadata): void;
  cachedAppServerMetadata(): SharedAppServerMetadata | null;
}
