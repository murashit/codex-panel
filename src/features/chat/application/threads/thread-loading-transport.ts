import type { ThreadActivationSnapshot } from "../../../../domain/threads/activation";
import type { ThreadStreamItem } from "../../domain/thread-stream/items";

export interface ThreadHistoryPage {
  items: ThreadStreamItem[];
  nextCursor: string | null;
  hadTurns: boolean;
}

export interface ThreadHistoryTransport {
  readHistoryPage(threadId: string, cursor: string | null, limit: number): Promise<ThreadHistoryPage | null>;
}

export interface ThreadResumeSnapshot {
  activation: ThreadActivationSnapshot;
  rolloutPath: string | null;
  initialHistoryPage: ThreadHistoryPage | null;
}

export interface ThreadResumeTransport {
  resumeThread(threadId: string): Promise<ThreadResumeSnapshot | null>;
}
