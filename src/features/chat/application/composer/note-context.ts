import type { VaultFileReference } from "../../../../domain/chat/input";

export interface DailyNoteReferenceCandidate {
  keyword: "today" | "tomorrow" | "yesterday";
  display: string;
  name: string;
  path: string;
  linktext: string;
}

export interface NoteHeadingCandidate {
  heading: string;
  linkHeading: string;
  level: number;
}

export interface NoteCandidate {
  basename: string;
  displayName: string;
  path: string;
  mtime: number;
  linktext: string;
  headings: NoteHeadingCandidate[];
  recentIndex: number | null;
}

export interface NoteCandidateProvider {
  candidates(sourcePath: string): readonly NoteCandidate[];
  dailyNoteReferences(sourcePath: string): readonly DailyNoteReferenceCandidate[];
  tags(): readonly string[];
  resolveFileReference(target: string, sourcePath: string): VaultFileReference | null;
  dispose(): void;
}
