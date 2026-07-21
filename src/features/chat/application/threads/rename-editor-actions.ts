import { threadRenameDraftTitle } from "../../../../domain/threads/title";
import type { ThreadTitleContext } from "../../../../domain/threads/title-generation-model";
import { activeThreadId, type ChatAction, type ChatState } from "../state/root-reducer";
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
  resolveThreadTitleContext(threadId: string): Promise<ThreadTitleContext | null>;
  generateThreadTitle(context: ThreadTitleContext, signal?: AbortSignal): Promise<string | null>;
}

export interface ThreadRenameEditorActions {
  invalidate(): void;
  editState(threadId: string): RenameEditState | null;
  isEditing(): boolean;
  start(threadId: string): void;
  updateDraft(threadId: string, value: string): void;
  cancel(threadId: string): void;
  cancelAutoName(threadId: string): void;
  save(threadId: string, value: string): Promise<void>;
  autoNameDraft(threadId: string): Promise<void>;
}

export function createThreadRenameEditorActions(host: ThreadRenameEditorActionsHost): ThreadRenameEditorActions {
  let nextRenameGenerationToken = 1;
  let activeGeneration: { threadId: string; generationToken: number; controller: AbortController } | null = null;
  let activeContextPreparation: { threadId: string } | null = null;

  const action = {
    invalidate(): void {
      activeGeneration?.controller.abort();
      activeGeneration = null;
      activeContextPreparation = null;
      dispatch(host, { type: "ui/rename-cleared" });
    },

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
      abortActiveGeneration();
      dispatch(host, { type: "ui/rename-started", threadId, draft: threadRenameDraftTitle(thread) });
      void prepareAutoName(threadId);
    },

    updateDraft(threadId: string, value: string): void {
      dispatch(host, { type: "ui/rename-draft-updated", threadId, draft: value });
    },

    cancel(threadId: string): void {
      abortGeneration(threadId);
      if (activeContextPreparation?.threadId === threadId) activeContextPreparation = null;
      dispatch(host, { type: "ui/rename-cancelled", threadId });
    },

    cancelAutoName(threadId: string): void {
      const current = renameState(host);
      if (current.kind !== "generating" || current.threadId !== threadId) return;
      abortGeneration(threadId);
      finishAutoNameDraftGeneration(host, threadId, current.generationToken);
    },

    async save(threadId: string, value: string): Promise<void> {
      const current = renameState(host);
      if (current.kind === "idle" || current.threadId !== threadId || current.kind === "generating") return;
      const editingState = current;

      try {
        await host.ensureConnected();
        if (!renameEditStillCurrent(host, threadId, editingState.draft)) return;

        const result = await host.renameThread(threadId, value);
        if (!result) {
          if (renameEditStillCurrent(host, threadId, editingState.draft)) action.cancel(threadId);
          return;
        }
        if (renameEditStillCurrent(host, threadId, editingState.draft)) {
          dispatch(host, { type: "ui/rename-cleared" });
        }
      } catch (error) {
        if (!renameEditStillCurrent(host, threadId, editingState.draft)) return;
        host.addSystemMessage(error instanceof Error ? error.message : String(error));
      }
    },

    async autoNameDraft(threadId: string): Promise<void> {
      const current = renameState(host);
      if (current.kind !== "editing" || current.threadId !== threadId) return;

      dispatch(host, {
        type: "ui/rename-generation-started",
        threadId,
        generationToken: nextRenameGenerationToken,
      });
      const generationToken = nextRenameGenerationToken;
      const generating = renameState(host);
      if (!renameGenerationStillActive(generating, threadId, generationToken)) return;
      nextRenameGenerationToken += 1;
      const controller = new AbortController();
      activeGeneration = { threadId, generationToken, controller };

      try {
        const title = await host.generateThreadTitle(generating.autoName.context, controller.signal);
        if (!title) throw new Error("Codex did not return a usable thread title.");
        dispatch(host, { type: "ui/rename-generation-succeeded", threadId, generationToken, draft: title });
      } catch (error) {
        if (renameGenerationStillActive(renameState(host), threadId, generationToken)) {
          host.addSystemMessage(error instanceof Error ? error.message : String(error));
        }
      } finally {
        clearGeneration(generationToken);
        finishAutoNameDraftGeneration(host, threadId, generationToken);
      }
    },
  };

  return action;

  function abortGeneration(threadId: string): void {
    if (activeGeneration?.threadId !== threadId) return;
    abortActiveGeneration();
  }

  function abortActiveGeneration(): void {
    if (!activeGeneration) return;
    activeGeneration.controller.abort();
    activeGeneration = null;
  }

  function clearGeneration(generationToken: number): void {
    if (activeGeneration?.generationToken === generationToken) activeGeneration = null;
  }

  async function prepareAutoName(threadId: string): Promise<void> {
    const preparation = { threadId };
    activeContextPreparation = preparation;
    let context: ThreadTitleContext | null = null;
    try {
      await host.ensureConnected();
      if (activeContextPreparation !== preparation) return;
      context = await host.resolveThreadTitleContext(threadId);
    } catch {
      // Auto-name availability is reflected by the disabled action.
    }
    if (activeContextPreparation !== preparation) return;
    activeContextPreparation = null;
    const current = renameState(host);
    if (current.kind !== "editing" || current.threadId !== threadId) return;
    dispatch(host, { type: "ui/rename-auto-name-context-resolved", threadId, context });
  }
}

export function activeThreadRenameTitleContext(state: ChatState, threadId: string): ThreadTitleContext | null {
  return activeThreadId(state) === threadId ? firstThreadTitleContextFromThreadStreamItems(threadStreamItems(state.threadStream)) : null;
}

function renameState(host: ThreadRenameEditorActionsHost): ChatRenameUiState {
  return host.stateStore.getState().ui.rename;
}

function renameEditStillCurrent(host: ThreadRenameEditorActionsHost, threadId: string, draft: string): boolean {
  const current = renameState(host);
  return current.kind === "editing" && current.threadId === threadId && current.draft === draft;
}

function dispatch(host: ThreadRenameEditorActionsHost, action: ChatAction): void {
  host.stateStore.dispatch(action);
}

function finishAutoNameDraftGeneration(host: ThreadRenameEditorActionsHost, threadId: string, generationToken: number): void {
  dispatch(host, { type: "ui/rename-generation-finished", threadId, generationToken });
}
