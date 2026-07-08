import type { Thread } from "../../../../domain/threads/model";
import type { MessageStreamItem } from "../../domain/message-stream/items";

export interface ThreadRollbackSnapshot {
  thread: Thread;
  cwd: string;
  items: MessageStreamItem[];
}

export interface ThreadMutationTransport {
  compactThread(threadId: string): Promise<boolean>;
  forkThread(threadId: string, lastTurnId?: string | null): Promise<Thread | null>;
  rollbackThread(threadId: string): Promise<ThreadRollbackSnapshot | null>;
}
