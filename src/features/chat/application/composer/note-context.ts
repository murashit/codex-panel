import type { VaultFileReference } from "../../../../domain/chat/input";
import type { DailyNoteReferenceCandidate } from "./daily-note-references";
import type { NoteCandidate } from "./suggestions";

export interface NoteCandidateProvider {
  candidates(sourcePath: string): readonly NoteCandidate[];
  dailyNoteReferences(sourcePath: string): readonly DailyNoteReferenceCandidate[];
  tags(): readonly string[];
  resolveFileReference(target: string, sourcePath: string): VaultFileReference | null;
  dispose(): void;
}
