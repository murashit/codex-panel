import type { SharedAppServerMetadata } from "../../../app-server/shared-cache-state";
import type { Thread } from "../../../domain/threads/model";
import type { ChatServerMetadataActions } from "../server-actions/metadata-actions";
import type { ChatServerThreadActions } from "../server-actions/thread-actions";

export interface CachedSharedAppServerStateSource {
  cachedThreadList: () => readonly Thread[] | null;
  cachedAppServerMetadata: () => SharedAppServerMetadata | null;
}

export function applyCachedSharedAppServerState(
  source: CachedSharedAppServerStateSource,
  serverThreads: ChatServerThreadActions,
  serverMetadata: ChatServerMetadataActions,
): void {
  const threads = source.cachedThreadList();
  if (threads) serverThreads.applyThreadList(threads);
  const metadata = source.cachedAppServerMetadata();
  if (metadata) serverMetadata.applyAppServerMetadata(metadata);
}
