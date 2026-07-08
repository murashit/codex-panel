import type { ThreadStreamFileChange, ThreadStreamItem } from "../../../domain/thread-stream/items";
import { patchApplyExecutionState } from "./execution-state";

export interface AppServerFileChange {
  readonly path: string;
  readonly kind: {
    readonly type: string;
  };
  readonly diff: string;
}

export function normalizeFileChanges(changes: readonly AppServerFileChange[]): ThreadStreamFileChange[] {
  return changes.map((change) => ({
    kind: change.kind.type,
    path: change.path,
    diff: change.diff,
  }));
}

export function streamingFileChangeThreadStreamItem(
  itemId: string,
  turnId: string,
  changes: readonly ThreadStreamFileChange[],
  status: string,
): ThreadStreamItem {
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
