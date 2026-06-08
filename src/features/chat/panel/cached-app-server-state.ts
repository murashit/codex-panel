import type { ChatAppServerMetadataActions } from "../app-server/metadata-actions";
import type { ChatAppServerThreadActions } from "../app-server/thread-actions";
import type { ChatPanelContext } from "./context";

export function applyCachedSharedAppServerState(
  context: ChatPanelContext,
  appServerThreads: ChatAppServerThreadActions,
  appServerMetadata: ChatAppServerMetadataActions,
): void {
  const threads = context.plugin.cachedThreadList();
  if (threads) appServerThreads.applyThreadList(threads);
  const metadata = context.plugin.cachedAppServerMetadata();
  if (metadata) appServerMetadata.applyAppServerMetadata(metadata);
}
