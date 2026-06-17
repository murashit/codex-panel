import type { Thread } from "../../../../domain/threads/model";
import type { ThreadConversationSummary } from "../../../../domain/threads/transcript";
import type { ThreadTitleContext } from "../../../../domain/threads/title-generation-model";
import type { ThreadTitleService } from "../../../threads/thread-title-service";
import type { ChatState } from "../state/root-reducer";
import type { ChatStateStore } from "../state/store";

export interface AutoTitleActionsHost {
  stateStore: ChatStateStore;
  completedTurnTitleContext: ThreadTitleService["completedTurnContext"];
  generateTitleFromContext: ThreadTitleService["generate"];
  renameGeneratedTitle(threadId: string, title: string, options: { shouldPublish: () => boolean }): Promise<boolean>;
}

export interface AutoTitleActions {
  resetThreadTurnPresence(hadTurns: boolean): void;
  maybeAutoTitleThread(threadId: string, turnId: string, completedSummary: ThreadConversationSummary | null): void;
}

export function createAutoTitleActions(host: AutoTitleActionsHost): AutoTitleActions {
  let activeThreadHadTurns = false;
  const attemptedThreadIds = new Set<string>();
  const inFlightThreadIds = new Set<string>();

  const thread = (threadId: string): Thread | undefined => state(host).threadList.listedThreads.find((item) => item.id === threadId);
  const threadHasTitle = (threadId: string): boolean => Boolean(thread(threadId)?.name?.trim());
  const threadCanReceiveGeneratedTitle = (threadId: string): boolean => {
    const candidate = thread(threadId);
    return Boolean(candidate && !candidate.name?.trim());
  };
  const generateAndSetTitle = async (threadId: string, context: ThreadTitleContext): Promise<void> => {
    try {
      const title = await host.generateTitleFromContext(context);
      if (!title || !threadCanReceiveGeneratedTitle(threadId)) return;

      await host.renameGeneratedTitle(threadId, title, {
        shouldPublish: () => threadCanReceiveGeneratedTitle(threadId),
      });
    } catch {
      // Auto-title is best-effort metadata. Leave the thread preview untouched on failure.
    } finally {
      inFlightThreadIds.delete(threadId);
    }
  };

  return {
    resetThreadTurnPresence(hadTurns) {
      activeThreadHadTurns = hadTurns;
    },

    maybeAutoTitleThread(threadId, turnId, completedSummary) {
      const hadTurnsBeforeThisCompletion = activeThreadHadTurns;
      activeThreadHadTurns = true;

      if (hadTurnsBeforeThisCompletion) return;
      if (threadHasTitle(threadId)) return;
      if (attemptedThreadIds.has(threadId) || inFlightThreadIds.has(threadId)) return;
      const context = host.completedTurnTitleContext(turnId, completedSummary);
      if (!context) return;

      attemptedThreadIds.add(threadId);
      inFlightThreadIds.add(threadId);
      void generateAndSetTitle(threadId, context);
    },
  };
}

function state(host: AutoTitleActionsHost): ChatState {
  return host.stateStore.getState();
}
