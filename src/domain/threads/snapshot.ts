import type { Thread } from "./model";
import type { ThreadConversationSummary, ThreadTranscriptEntry } from "./transcript";

export interface ArchiveableThread extends Thread {
  transcriptEntries: readonly ThreadTranscriptEntry[];
}

export interface ThreadConversationSummaryPage {
  data: ThreadConversationSummary[];
  nextCursor: string | null;
}
