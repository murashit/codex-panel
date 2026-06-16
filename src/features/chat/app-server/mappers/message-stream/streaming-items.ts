import type { MessageStreamFileChange, MessageStreamItem } from "../../../domain/message-stream/items";

export function streamingFileChangeMessageStreamItem(
  itemId: string,
  turnId: string,
  changes: readonly MessageStreamFileChange[],
  status: string,
): MessageStreamItem {
  return {
    id: itemId,
    kind: "fileChange",
    role: "tool",
    turnId,
    sourceItemId: itemId,
    provenance: { source: "appServer", channel: "notification", event: "streamingDelta", sourceItemId: itemId },
    status,
    changes,
  };
}
