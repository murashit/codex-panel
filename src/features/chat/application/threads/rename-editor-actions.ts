import { threadRenameDraftTitle } from "../../../../domain/threads/title";
import type { ThreadTitleContext } from "../../../../domain/threads/title-generation-model";
import type { ChatAction, ChatState } from "../state/root-reducer";
import type { ChatStateStore } from "../state/store";
import { threadStreamItems } from "../state/thread-stream";
import { type ChatRenameUiState, renameGenerationStillActive } from "../state/ui-state";
import { firstThreadTitleContextFromThreadStreamItems } from "./title-context";

interface RenameEditState {
  draft: string;
  generating: boolean;
}

export interface ThreadRenameEditorActionsHost {
  stateStore: ChatStateStore;
  ensureConnected: () => Promise<void>;
  addSystemMessage: (text: string) => void;
  renameThread(threadId: string, value: string): Promise<boolean>;
  generateThreadTitle(threadId: string): Promise<string>;
}

export interface ThreadRenameEditorActions {
  editState(threadId: string): RenameEditState | null;
  isEditing(): boolean;
  start(threadId: string): void;
  updateDraft(threadId: string, value: string): void;
  cancel(threadId: string): void;
  save(threadId: string, value: string): Promise<void>;
  autoNameDraft(threadId: string): Promise<void>;
}

export function createThreadRenameEditorActions(host: ThreadRenameEditorActionsHost): ThreadRenameEditorActions {
  let nextRenameGenerationToken = 1;

  const action = {
    editState(threadId: string): RenameEditState | null {
      const current = renameState(host);
      if (current.kind === "idle" || current.threadId !== threadId) return null;
      return {
        draft: current.draft,
        generating: current.kind === "generating",
      };
    },

    isEditing(): boolean {
      return renameState(host).kind !== "idle";
    },

    start(threadId: string): void {
      const thread = host.stateStore.getState().threadList.listedThreads.find((item) => item.id === threadId);
      if (!thread) return;
      dispatch(host, { type: "ui/rename-started", threadId, draft: threadRenameDraftTitle(thread) });
    },

    updateDraft(threadId: string, value: string): void {
      dispatch(host, { type: "ui/rename-draft-updated", threadId, draft: value });
    },

    cancel(threadId: string): void {
      dispatch(host, { type: "ui/rename-cancelled", threadId });
    },

    async save(threadId: string, value: string): Promise<void> {
      const current = renameState(host);
      if (current.kind === "idle" || current.threadId !== threadId || current.kind === "generating") return;
      const editingState = current;

      await host.ensureConnected();
      if (renameState(host) !== editingState) return;

      const result = await host.renameThread(threadId, value);
      if (!result) {
        if (renameState(host) === editingState) action.cancel(threadId);
        return;
      }
      if (renameState(host) === editingState) {
        dispatch(host, { type: "ui/rename-cleared" });
      }
    },

    async autoNameDraft(threadId: string): Promise<void> {
      const current = renameState(host);
      if (current.kind !== "editing" || current.threadId !== threadId) return;

      const editingState = current;

      await host.ensureConnected();
      if (renameState(host) !== editingState) return;

      dispatch(host, {
        type: "ui/rename-generation-started",
        threadId,
        generationToken: nextRenameGenerationToken,
      });
      const generationToken = nextRenameGenerationToken;
      if (!renameGenerationStillActive(renameState(host), threadId, generationToken)) return;
      nextRenameGenerationToken += 1;

      try {
        const title = await host.generateThreadTitle(threadId);
        dispatch(host, { type: "ui/rename-generation-succeeded", threadId, generationToken, draft: title });
      } catch (error) {
        if (renameGenerationStillActive(renameState(host), threadId, generationToken)) {
          host.addSystemMessage(error instanceof Error ? error.message : String(error));
        }
      } finally {
        finishAutoNameDraftGeneration(host, threadId, generationToken);
      }
    },
  };

  return action;
}

export function activeThreadRenameTitleContext(state: ChatState, threadId: string): ThreadTitleContext | null {
  return state.activeThread.id === threadId ? firstThreadTitleContextFromThreadStreamItems(threadStreamItems(state.threadStream)) : null;
}

function renameState(host: ThreadRenameEditorActionsHost): ChatRenameUiState {
  return host.stateStore.getState().ui.rename;
}

function dispatch(host: ThreadRenameEditorActionsHost, action: ChatAction): void {
  host.stateStore.dispatch(action);
}

function finishAutoNameDraftGeneration(host: ThreadRenameEditorActionsHost, threadId: string, generationToken: number): void {
  dispatch(host, { type: "ui/rename-generation-finished", threadId, generationToken });
}
