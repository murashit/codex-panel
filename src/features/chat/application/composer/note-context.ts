import type { NoteCandidate } from "./suggestions";

export interface WikiLinkMention {
  name: string;
  path: string;
}

export interface NoteCandidateProvider {
  candidates(sourcePath: string): readonly NoteCandidate[];
  tags(): readonly string[];
  resolveMention(target: string, sourcePath: string): WikiLinkMention | null;
  dispose(): void;
}
