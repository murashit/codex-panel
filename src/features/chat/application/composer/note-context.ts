import type { DailyNoteReferenceCandidate } from "./daily-note-references";
import type { NoteCandidate } from "./suggestions";

export interface WikiLinkMention {
  name: string;
  path: string;
}

export interface NoteCandidateProvider {
  candidates(sourcePath: string): readonly NoteCandidate[];
  dailyNoteReferences(sourcePath: string): readonly DailyNoteReferenceCandidate[];
  tags(): readonly string[];
  resolveMention(target: string, sourcePath: string): WikiLinkMention | null;
  dispose(): void;
}
