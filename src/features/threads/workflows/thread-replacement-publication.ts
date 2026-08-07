import type { Thread } from "../../../domain/threads/model";
import type { ThreadFact, ThreadFactSink } from "./thread-facts";

interface ThreadReplacementPublication {
  finish(): void;
}

export interface ThreadReplacementPublicationOwner {
  readonly facts: ThreadFactSink;
  begin(sourceThreadId: string, replacementThread: Thread): ThreadReplacementPublication;
}

interface PendingReplacement {
  readonly sourceThreadId: string;
  readonly replacementThreadId: string;
  readonly initialReplacement: Thread;
  readonly facts: ThreadFact[];
  finished: boolean;
}

export function createThreadReplacementPublication(commit: (facts: readonly ThreadFact[]) => void): ThreadReplacementPublicationOwner {
  const pendingByThreadId = new Map<string, PendingReplacement>();

  const applyBatch = (facts: readonly ThreadFact[]): void => {
    const immediate: ThreadFact[] = [];
    for (const fact of facts) {
      const pending = pendingByThreadId.get(threadIdForFact(fact));
      if (!pending) {
        immediate.push(fact);
        continue;
      }
      pending.facts.push(fact);
    }
    if (immediate.length > 0) commit(immediate);
  };

  const facts: ThreadFactSink = {
    apply: (fact) => {
      applyBatch([fact]);
    },
    applyBatch: (batch) => {
      applyBatch(batch);
    },
  };

  return {
    facts,
    begin: (sourceThreadId, replacementThread) => {
      if (pendingByThreadId.has(sourceThreadId) || pendingByThreadId.has(replacementThread.id)) {
        throw new Error("A replacement publication is already in progress for this thread.");
      }
      const pending: PendingReplacement = {
        sourceThreadId,
        replacementThreadId: replacementThread.id,
        initialReplacement: replacementThread,
        facts: [],
        finished: false,
      };
      pendingByThreadId.set(sourceThreadId, pending);
      pendingByThreadId.set(replacementThread.id, pending);

      return {
        finish: () => {
          if (pending.finished) return;
          pending.finished = true;
          pendingByThreadId.delete(pending.sourceThreadId);
          pendingByThreadId.delete(pending.replacementThreadId);

          const completedFacts: ThreadFact[] = [{ type: "thread-upserted", thread: pending.initialReplacement }, ...pending.facts];
          commit(completedFacts);
        },
      };
    },
  };
}

function threadIdForFact(fact: ThreadFact): string {
  return fact.type === "thread-upserted" ? fact.thread.id : fact.threadId;
}
