import type { SkillMetadata } from "../../../../domain/catalog/metadata";
import type { ComposerAttachment } from "./attachments";
import type { ActiveNoteContextReference, ComposerContextReferences, SelectionContextReference } from "./context-references";
import type { ThreadCommandTarget } from "./thread-title-argument";

export interface ComposerInputSnapshot {
  readonly sourcePath: string;
  readonly availableSkills: readonly SkillMetadata[];
  readonly referenceActiveNoteOnSend: boolean;
  readonly contextReferences: ComposerContextReferences;
  readonly activeNoteSnapshots: readonly ActiveNoteContextReference[];
  readonly selectionSnapshots: readonly SelectionContextReference[];
  readonly attachments: readonly ComposerAttachment[];
  readonly threadCommandTarget?: ThreadCommandTarget;
}
