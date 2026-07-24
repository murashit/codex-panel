import type { ThreadTitleContext } from "../../../domain/threads/title-generation-model";
import type { KeyedOperationQueue } from "../../../shared/runtime/keyed-operation-queue";
import type { ThreadMutationPort, ThreadTitlePort } from "./ports";
import type { ThreadFact, ThreadFactSink } from "./thread-facts";

export interface ThreadAutoTitleWork {
  submit(threadId: string, context: ThreadTitleContext): void;
  applyThreadFact(fact: ThreadFact): void;
  dispose(): void;
}

interface ThreadAutoTitleWorkHost {
  titlePort: ThreadTitlePort;
  mutationPort: Pick<ThreadMutationPort, "renameThread">;
  nameMutations: KeyedOperationQueue<string>;
  facts: ThreadFactSink;
}

export function createThreadAutoTitleWork(host: ThreadAutoTitleWorkHost): ThreadAutoTitleWork {
  let disposed = false;
  const attemptedThreadIds = new Set<string>();
  const titledThreadIds = new Set<string>();
  const unavailableThreadIds = new Set<string>();
  const generationControllers = new Map<string, AbortController>();

  const operationIsCurrent = (threadId: string, controller: AbortController): boolean =>
    !disposed &&
    generationControllers.get(threadId) === controller &&
    !titledThreadIds.has(threadId) &&
    !unavailableThreadIds.has(threadId);
  const cancelThreadWork = (threadId: string): void => {
    generationControllers.get(threadId)?.abort();
    generationControllers.delete(threadId);
  };

  const generateAndRename = async (threadId: string, context: ThreadTitleContext, controller: AbortController): Promise<void> => {
    try {
      const title = await host.titlePort.generateTitle(context, controller.signal);
      if (!title || !operationIsCurrent(threadId, controller)) return;
      await host.nameMutations.run(threadId, async () => {
        if (!operationIsCurrent(threadId, controller)) return;
        await host.mutationPort.renameThread(threadId, title);
        if (!operationIsCurrent(threadId, controller)) return;
        host.facts.apply({ type: "thread-renamed", threadId, name: title });
      });
    } catch {
      // First-turn naming is best-effort shared metadata work.
    } finally {
      if (generationControllers.get(threadId) === controller) generationControllers.delete(threadId);
    }
  };

  return {
    submit(threadId, context) {
      if (disposed || unavailableThreadIds.has(threadId) || titledThreadIds.has(threadId) || attemptedThreadIds.has(threadId)) return;
      attemptedThreadIds.add(threadId);
      const controller = new AbortController();
      generationControllers.set(threadId, controller);
      void generateAndRename(threadId, context, controller);
    },

    applyThreadFact(fact) {
      switch (fact.type) {
        case "thread-renamed":
          if (fact.name?.trim()) {
            titledThreadIds.add(fact.threadId);
            cancelThreadWork(fact.threadId);
          } else {
            titledThreadIds.delete(fact.threadId);
          }
          return;
        case "thread-upserted":
        case "thread-restored":
          unavailableThreadIds.delete(fact.thread.id);
          if (fact.thread.name?.trim()) {
            titledThreadIds.add(fact.thread.id);
            cancelThreadWork(fact.thread.id);
          } else {
            titledThreadIds.delete(fact.thread.id);
          }
          return;
        case "thread-archived":
        case "thread-deleted":
          unavailableThreadIds.add(fact.threadId);
          cancelThreadWork(fact.threadId);
          return;
        case "thread-unarchived":
          unavailableThreadIds.delete(fact.threadId);
          return;
      }
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      for (const controller of generationControllers.values()) controller.abort();
      generationControllers.clear();
    },
  };
}
