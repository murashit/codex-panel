import type { SharedServerMetadata } from "../../../domain/server/metadata";
import type { Thread } from "../../../domain/threads/model";
import type { ChatServerMetadataActions } from "../connection/server-actions/metadata";
import type { ChatServerThreadActions } from "../connection/server-actions/threads";

export interface CachedSharedAppServerStateSource {
  cachedThreadList: () => readonly Thread[] | null;
  cachedAppServerMetadata: () => SharedServerMetadata | null;
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
