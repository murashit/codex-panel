import type { Thread } from "../../../domain/threads/model";

export type ThreadLifecycleEvent =
  | { type: "thread-upserted"; thread: Thread }
  | { type: "thread-renamed"; threadId: string; name: string | null }
  | { type: "thread-archived"; threadId: string }
  | { type: "thread-deleted"; threadId: string }
  | { type: "thread-restored"; thread: Thread }
  | { type: "thread-unarchived"; threadId: string };

export type ThreadOperationEvent =
  | Exclude<ThreadLifecycleEvent, { type: "thread-upserted" }>
  | { type: "thread-upserted"; thread: Thread; forkedFromThreadId?: string | null };

export interface ThreadOperationEventSink {
  apply(event: ThreadOperationEvent): void;
}

export type ThreadOperationCommitter = (events: readonly ThreadLifecycleEvent[]) => void;
