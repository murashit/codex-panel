import type { ThreadTitleContext } from "../../../domain/threads/title-context";
import type { ThreadTitlePort } from "./ports";
import type { ThreadFact } from "./thread-facts";
import type { ThreadMutationCommands } from "./thread-mutation-commands";

export interface ThreadAutoTitleWork {
  submit(threadId: string, context: ThreadTitleContext): void;
  applyThreadFact(fact: ThreadFact): void;
  dispose(): void;
}

interface ThreadAutoTitleWorkHost {
  titlePort: ThreadTitlePort;
  mutations: Pick<ThreadMutationCommands, "renameThread">;
}

export function createThreadAutoTitleWork(host: ThreadAutoTitleWorkHost): ThreadAutoTitleWork {
  let disposed = false;
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
      await host.mutations.renameThread(threadId, title, {
        shouldStart: () => operationIsCurrent(threadId, controller),
      });
    } catch {
      // First-turn naming is best-effort shared metadata work.
    } finally {
      if (generationControllers.get(threadId) === controller) generationControllers.delete(threadId);
    }
  };

  return {
    submit(threadId, context) {
      if (disposed || unavailableThreadIds.has(threadId) || titledThreadIds.has(threadId) || generationControllers.has(threadId)) return;
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
        case "thread-pinned":
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
