import type { Thread } from "../../../domain/threads/model";

export type ThreadFact =
  | { type: "thread-upserted"; thread: Thread }
  | { type: "thread-renamed"; threadId: string; name: string | null }
  | { type: "thread-pinned"; threadId: string; isPinned: boolean }
  | { type: "thread-archived"; threadId: string }
  | { type: "thread-deleted"; threadId: string }
  | { type: "thread-unarchived"; threadId: string };

export interface ThreadFactSink {
  apply(fact: ThreadFact): void;
  applyBatch(facts: readonly ThreadFact[]): void;
}
