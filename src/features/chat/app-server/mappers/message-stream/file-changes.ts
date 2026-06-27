import type { MessageStreamFileChange, MessageStreamItem } from "../../../domain/message-stream/items";
import { patchApplyExecutionState } from "./execution-state";

export interface AppServerFileChange {
  readonly path: string;
  readonly kind: {
    readonly type: string;
  };
  readonly diff: string;
}

export function normalizeFileChanges(changes: readonly AppServerFileChange[]): MessageStreamFileChange[] {
  return changes.map((change) => ({
    kind: change.kind.type,
    path: change.path,
    diff: change.diff,
  }));
}

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
    executionState: patchApplyExecutionState(status),
    changes,
  };
}
