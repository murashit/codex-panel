export interface DailyNoteReferenceCandidate {
  keyword: "today" | "tomorrow" | "yesterday";
  display: string;
  name: string;
  path: string;
  linktext: string;
}
