import type { Thread } from "../../../domain/threads/model";
import type { ThreadFact, ThreadFactSink } from "./thread-facts";

interface ThreadReplacementPublication {
  attach(replacementThread: Thread): void;
  finish(sourceArchived: boolean): void;
}

export interface ThreadReplacementPublicationOwner {
  readonly facts: ThreadFactSink;
  begin(sourceThreadId: string): ThreadReplacementPublication;
}

interface PendingReplacement {
  readonly sourceThreadId: string;
  initialReplacement: Thread | null;
  readonly facts: ThreadFact[];
  readonly releaseActiveThreads: () => void;
  finished: boolean;
}

export function createThreadReplacementPublication(
  commit: (facts: readonly ThreadFact[]) => void,
  freezeActiveThreads: () => () => void = () => () => undefined,
): ThreadReplacementPublicationOwner {
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
    begin: (sourceThreadId) => {
      if (pendingByThreadId.has(sourceThreadId)) {
        throw new Error("A replacement publication is already in progress for this thread.");
      }
      const pending: PendingReplacement = {
        sourceThreadId,
        initialReplacement: null,
        facts: [],
        releaseActiveThreads: freezeActiveThreads(),
        finished: false,
      };
      pendingByThreadId.set(sourceThreadId, pending);

      return {
        attach: (replacementThread) => {
          if (pending.finished) throw new Error("The replacement publication has already finished.");
          if (pending.initialReplacement) throw new Error("A replacement thread is already attached.");
          if (pendingByThreadId.has(replacementThread.id)) {
            throw new Error("A replacement publication is already in progress for this thread.");
          }
          pending.initialReplacement = replacementThread;
          pendingByThreadId.set(replacementThread.id, pending);
        },
        finish: (sourceArchived) => {
          if (pending.finished) return;
          pending.finished = true;
          pendingByThreadId.delete(pending.sourceThreadId);
          if (pending.initialReplacement) pendingByThreadId.delete(pending.initialReplacement.id);

          pending.releaseActiveThreads();
          const completedFacts: ThreadFact[] = pending.initialReplacement
            ? [{ type: "thread-upserted", thread: pending.initialReplacement }, ...pending.facts]
            : [...pending.facts];
          if (
            pending.initialReplacement &&
            sourceArchived &&
            !pending.facts.some((fact) => factRemovesThread(fact, pending.sourceThreadId))
          ) {
            completedFacts.push({ type: "thread-archived", threadId: pending.sourceThreadId });
          }
          if (completedFacts.length > 0) commit(completedFacts);
        },
      };
    },
  };
}

function factRemovesThread(fact: ThreadFact, threadId: string): boolean {
  return (fact.type === "thread-archived" || fact.type === "thread-deleted") && fact.threadId === threadId;
}

function threadIdForFact(fact: ThreadFact): string {
  return fact.type === "thread-upserted" ? fact.thread.id : fact.threadId;
}
