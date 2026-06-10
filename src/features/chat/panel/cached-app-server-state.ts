import type { ChatServerMetadataActions } from "../server-actions/metadata-actions";
import type { ChatServerThreadActions } from "../server-actions/thread-actions";
import type { ChatPanelContext } from "./context";

export function applyCachedSharedAppServerState(
  context: ChatPanelContext,
  serverThreads: ChatServerThreadActions,
  serverMetadata: ChatServerMetadataActions,
): void {
  const threads = context.plugin.cachedThreadList();
  if (threads) serverThreads.applyThreadList(threads);
  const metadata = context.plugin.cachedAppServerMetadata();
  if (metadata) serverMetadata.applyAppServerMetadata(metadata);
}
