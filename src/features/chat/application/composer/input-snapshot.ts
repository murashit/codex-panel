import type { SkillMetadata } from "../../../../domain/catalog/metadata";
import type { ComposerAttachment } from "./attachments";
import type { ActiveNoteContextReference, ComposerContextReferences, SelectionContextReference } from "./context-references";

export interface ComposerInputSnapshot {
  readonly sourcePath: string;
  readonly availableSkills: readonly SkillMetadata[];
  readonly attachActiveNoteOnSend: boolean;
  readonly contextReferences: ComposerContextReferences;
  readonly activeNoteSnapshots: readonly ActiveNoteContextReference[];
  readonly selectionSnapshots: readonly SelectionContextReference[];
  readonly attachments: readonly ComposerAttachment[];
}
