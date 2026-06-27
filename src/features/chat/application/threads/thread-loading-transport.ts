import type { ThreadActivationSnapshot } from "../../../../domain/threads/activation";
import type { MessageStreamItem } from "../../domain/message-stream/items";

export interface ThreadHistoryPage {
  items: MessageStreamItem[];
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
