import type { ComposerAttachment } from "./attachments";
import type { ActiveNoteContextReference, SelectionContextReference } from "./context-references";
import type { ThreadCommandTarget } from "./thread-title-argument";

export interface ComposerRuntimeSnapshot {
  readonly draft: string;
  readonly attachments: readonly ComposerAttachment[];
  readonly activeNoteSnapshots: readonly ActiveNoteContextReference[];
  readonly selectionSnapshots: readonly SelectionContextReference[];
  readonly threadCommandTarget: ThreadCommandTarget | null;
}
