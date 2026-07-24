import type { ThreadActivationSnapshot } from "../../../../domain/threads/activation";
import type { ThreadStreamItem } from "../../domain/thread-stream/items";
import type { EffectOutcome } from "../effect-outcome";

export interface ThreadHistoryPage {
  items: ThreadStreamItem[];
  nextCursor: string | null;
  hadTurns: boolean;
}

export interface ThreadHistoryPort {
  readHistoryPage(threadId: string, cursor: string | null, limit: number): Promise<ThreadHistoryPage | null>;
}

export interface ThreadResumeSnapshot {
  activation: ThreadActivationSnapshot;
  rolloutPath: string | null;
  initialHistoryPage: ThreadHistoryPage | null;
}

export interface ThreadResumePort {
  ensureConnected(): Promise<boolean>;
  resumeThread(threadId: string): Promise<EffectOutcome<ThreadResumeSnapshot>>;
}
