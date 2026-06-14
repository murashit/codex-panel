import type { FileUpdateChange } from "../../../../../app-server/protocol/file-change";
import type { MessageStreamItem } from "../../../domain/message-stream/items";
import { normalizeFileChanges } from "./turn-items";

export function streamingFileChangeMessageStreamItem(
  itemId: string,
  turnId: string,
  changes: FileUpdateChange[],
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
    changes: normalizeFileChanges(changes),
  };
}
