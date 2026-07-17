import type { Thread } from "../../../../domain/threads/model";
import type { ThreadStreamItem } from "../../domain/thread-stream/items";
import type { EffectOutcome } from "../effect-outcome";

export interface ThreadRollbackSnapshot {
  thread: Thread;
  cwd: string;
  items: ThreadStreamItem[];
}

export interface ThreadMutationTransport {
  ensureConnected(): Promise<boolean>;
  compactThread(threadId: string): Promise<EffectOutcome<void>>;
  forkThread(threadId: string, lastTurnId?: string | null): Promise<EffectOutcome<Thread>>;
  rollbackThread(threadId: string): Promise<EffectOutcome<ThreadRollbackSnapshot>>;
}
