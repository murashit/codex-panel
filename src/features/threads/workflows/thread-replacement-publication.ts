import type { Thread } from "../../../domain/threads/model";
import type { ThreadFact, ThreadFactSink } from "./thread-facts";

interface ThreadReplacementPublication {
  finish(result: { readonly sourceArchived: boolean }): void;
}

export interface ThreadReplacementPublicationOwner {
  readonly facts: ThreadFactSink;
  readonly mutationFacts: ThreadFactSink;
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

  const applyBatch = (facts: readonly ThreadFact[], source: "observation" | "mutation"): void => {
    const immediate: ThreadFact[] = [];
    for (const fact of facts) {
      const pending = pendingByThreadId.get(threadIdForFact(fact));
      if (!pending) {
        immediate.push(fact);
        continue;
      }
      if (source === "mutation" && fact.type === "thread-archived" && fact.threadId === pending.sourceThreadId) continue;
      pending.facts.push(fact);
    }
    if (immediate.length > 0) commit(immediate);
  };

  const facts = (source: "observation" | "mutation"): ThreadFactSink => ({
    apply: (fact) => {
      applyBatch([fact], source);
    },
    applyBatch: (batch) => {
      applyBatch(batch, source);
    },
  });

  return {
    facts: facts("observation"),
    mutationFacts: facts("mutation"),
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
        finish: ({ sourceArchived }) => {
          if (pending.finished) return;
          pending.finished = true;
          pendingByThreadId.delete(pending.sourceThreadId);
          pendingByThreadId.delete(pending.replacementThreadId);

          const completedFacts: ThreadFact[] = [{ type: "thread-upserted", thread: pending.initialReplacement }, ...pending.facts];
          if (sourceArchived && !sourceLifecycleWasObserved(pending)) {
            completedFacts.push({ type: "thread-archived", threadId: pending.sourceThreadId });
          }
          commit(completedFacts);
        },
      };
    },
  };
}

function sourceLifecycleWasObserved(pending: PendingReplacement): boolean {
  return pending.facts.some((fact) => {
    if (threadIdForFact(fact) !== pending.sourceThreadId) return false;
    return (
      fact.type === "thread-archived" ||
      fact.type === "thread-deleted" ||
      fact.type === "thread-restored" ||
      fact.type === "thread-unarchived"
    );
  });
}

function threadIdForFact(fact: ThreadFact): string {
  return fact.type === "thread-upserted" || fact.type === "thread-restored" ? fact.thread.id : fact.threadId;
}
