import type { ChatAppServerMetadataController } from "../app-server/metadata-controller";
import type { ChatAppServerThreadController } from "../app-server/thread-controller";
import type { ChatPanelContext } from "./context";

export function applyCachedSharedAppServerState(
  context: ChatPanelContext,
  appServerThreads: ChatAppServerThreadController,
  appServerMetadata: ChatAppServerMetadataController,
): void {
  const threads = context.plugin.cachedThreadList();
  if (threads) appServerThreads.applyThreadList(threads);
  const metadata = context.plugin.cachedAppServerMetadata();
  if (metadata) appServerMetadata.applyAppServerMetadata(metadata);
}
