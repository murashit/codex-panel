import type { MessageStreamFileChange } from "../../../domain/message-stream/items";

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
