import type { Thread } from "../../../domain/threads/model";

export type ThreadFact =
  | { type: "thread-upserted"; thread: Thread }
  | { type: "thread-renamed"; threadId: string; name: string | null }
  | { type: "thread-archived"; threadId: string }
  | { type: "thread-deleted"; threadId: string }
  | { type: "thread-restored"; thread: Thread }
  | { type: "thread-unarchived"; threadId: string };

export type ThreadFactInput =
  | Exclude<ThreadFact, { type: "thread-upserted" }>
  | { type: "thread-upserted"; thread: Thread; forkedFromThreadId?: string | null };

export interface ThreadFactSink {
  apply(fact: ThreadFactInput): void;
}

export type ThreadFactCommitter = (facts: readonly ThreadFact[]) => void;
