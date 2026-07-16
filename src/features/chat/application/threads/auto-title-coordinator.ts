import type { Thread } from "../../../../domain/threads/model";
import type { ThreadTitleContext } from "../../../../domain/threads/title-generation-model";
import type { TurnTranscriptSummary } from "../../../../domain/threads/transcript";
import type { ChatStateStore } from "../state/store";

export interface AutoTitleCoordinatorHost {
  stateStore: ChatStateStore;
  completedTurnTitleContext(turnId: string, completedTurnTranscriptSummary: TurnTranscriptSummary | null): ThreadTitleContext | null;
  generateTitleFromContext(context: ThreadTitleContext): Promise<string | null>;
  renameGeneratedTitle(
    threadId: string,
    title: string,
    options: { shouldStart: () => boolean; shouldPublish: () => boolean },
  ): Promise<boolean>;
}

export interface AutoTitleCoordinator {
  invalidate(): void;
  resetThreadTurnPresence(hadTurns: boolean): void;
  maybeAutoTitleThread(threadId: string, turnId: string, completedTurnTranscriptSummary: TurnTranscriptSummary | null): void;
}

export function createAutoTitleCoordinator(host: AutoTitleCoordinatorHost): AutoTitleCoordinator {
  let activeThreadHadTurns = false;
  let generation = 0;
  const attemptedThreadIds = new Set<string>();
  const inFlightThreadIds = new Set<string>();

  const thread = (threadId: string): Thread | undefined =>
    host.stateStore.getState().threadList.listedThreads.find((item) => item.id === threadId);
  const threadHasTitle = (threadId: string): boolean => Boolean(thread(threadId)?.name?.trim());
  const threadCanReceiveGeneratedTitle = (threadId: string): boolean => {
    const candidate = thread(threadId);
    return Boolean(candidate && !candidate.name?.trim());
  };
  const generateAndSetTitle = async (threadId: string, context: ThreadTitleContext, operationGeneration: number): Promise<void> => {
    try {
      const title = await host.generateTitleFromContext(context);
      if (operationGeneration !== generation || !title || !threadCanReceiveGeneratedTitle(threadId)) return;

      await host.renameGeneratedTitle(threadId, title, {
        shouldStart: () => operationGeneration === generation && threadCanReceiveGeneratedTitle(threadId),
        shouldPublish: () => operationGeneration === generation && threadCanReceiveGeneratedTitle(threadId),
      });
    } catch {
      // Auto-title is best-effort metadata. Leave the thread preview untouched on failure.
    } finally {
      if (operationGeneration === generation) inFlightThreadIds.delete(threadId);
    }
  };

  return {
    invalidate() {
      generation += 1;
      activeThreadHadTurns = false;
      attemptedThreadIds.clear();
      inFlightThreadIds.clear();
    },

    resetThreadTurnPresence(hadTurns) {
      activeThreadHadTurns = hadTurns;
    },

    maybeAutoTitleThread(threadId, turnId, completedTurnTranscriptSummary) {
      const hadTurnsBeforeThisCompletion = activeThreadHadTurns;
      activeThreadHadTurns = true;

      if (hadTurnsBeforeThisCompletion) return;
      if (threadHasTitle(threadId)) return;
      if (attemptedThreadIds.has(threadId) || inFlightThreadIds.has(threadId)) return;
      const context = host.completedTurnTitleContext(turnId, completedTurnTranscriptSummary);
      if (!context) return;

      attemptedThreadIds.add(threadId);
      inFlightThreadIds.add(threadId);
      void generateAndSetTitle(threadId, context, generation);
    },
  };
}
