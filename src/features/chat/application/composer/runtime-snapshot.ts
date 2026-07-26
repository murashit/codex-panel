import type { ThreadCommandTarget } from "../slash-commands/thread-arguments";
import type { ComposerAttachment } from "./attachments";
import type { ActiveNoteContextReference, SelectionContextReference } from "./context-references";

export interface ComposerRuntimeSnapshot {
  readonly draft: string;
  readonly attachments: readonly ComposerAttachment[];
  readonly activeNoteSnapshots: readonly ActiveNoteContextReference[];
  readonly selectionSnapshots: readonly SelectionContextReference[];
  readonly threadCommandTarget: ThreadCommandTarget | null;
}
