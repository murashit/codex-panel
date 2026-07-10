export interface DailyNoteReferenceCandidate {
  keyword: "today" | "tomorrow" | "yesterday";
  display: string;
  path: string;
  linktext: string;
}
