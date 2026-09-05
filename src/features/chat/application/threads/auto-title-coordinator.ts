import type { Thread } from "../../../../domain/threads/model";
import type { ThreadTitleContext } from "../../../../domain/threads/title-context";
import type { TurnTranscriptSummary } from "../../../../domain/threads/transcript";
import type { ChatStateStore } from "../state/store";

export interface AutoTitleCoordinatorHost {
  stateStore: ChatStateStore;
  threadById(threadId: string): Thread | undefined;
  completedTurnTitleContext(turnId: string, completedTurnTranscriptSummary: TurnTranscriptSummary | null): ThreadTitleContext | null;
  submitTitleWork(threadId: string, context: ThreadTitleContext): void;
}

export interface AutoTitleCoordinator {
  resetThreadTurnPresence(hadTurns: boolean): void;
  maybeAutoTitleThread(threadId: string, turnId: string, completedTurnTranscriptSummary: TurnTranscriptSummary | null): void;
}

export function createAutoTitleCoordinator(host: AutoTitleCoordinatorHost): AutoTitleCoordinator {
  let activeThreadHadTurns = false;

  const threadHasTitle = (threadId: string): boolean => Boolean(host.threadById(threadId)?.name?.trim());

  return {
    resetThreadTurnPresence(hadTurns) {
      activeThreadHadTurns = hadTurns;
    },

    maybeAutoTitleThread(threadId, turnId, completedTurnTranscriptSummary) {
      const hadTurnsBeforeThisCompletion = activeThreadHadTurns;
      activeThreadHadTurns = true;

      if (hadTurnsBeforeThisCompletion) return;
      if (threadHasTitle(threadId)) return;
      const context = host.completedTurnTitleContext(turnId, completedTurnTranscriptSummary);
      if (!context) return;

      host.submitTitleWork(threadId, context);
    },
  };
}
