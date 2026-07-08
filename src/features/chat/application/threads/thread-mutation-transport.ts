import type { Thread } from "../../../../domain/threads/model";
import type { ThreadStreamItem } from "../../domain/thread-stream/items";

export interface ThreadRollbackSnapshot {
  thread: Thread;
  cwd: string;
  items: ThreadStreamItem[];
}

export interface ThreadMutationTransport {
  compactThread(threadId: string): Promise<boolean>;
  forkThread(threadId: string, lastTurnId?: string | null): Promise<Thread | null>;
  rollbackThread(threadId: string): Promise<ThreadRollbackSnapshot | null>;
}
