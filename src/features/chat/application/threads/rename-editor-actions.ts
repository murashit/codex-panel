import type { Thread } from "../../../../domain/threads/model";
import { threadRenameDraftTitle } from "../../../../domain/threads/title";
import type { ThreadTitleContext } from "../../../../domain/threads/title-generation-model";
import { chatThreadStreamViewState } from "../state/active-turn";
import { activeThreadId, type ChatAction, type ChatState } from "../state/root-reducer";
import type { ChatStateStore } from "../state/store";
import { threadStreamItems } from "../state/thread-stream";
import type { ChatRenameUiState } from "../state/ui-state";
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
  threadById(threadId: string): Thread | undefined;
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
  let activeGeneration: { threadId: string; controller: AbortController } | null = null;
  let activeSave: object | null = null;
  let activeContextPreparation: { threadId: string } | null = null;

  const action = {
    invalidate(): void {
      activeGeneration?.controller.abort();
      activeGeneration = null;
      activeSave = null;
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
      const current = renameState(host);
      if (current.kind === "saving") return;
      const thread = host.threadById(threadId);
      if (!thread) return;
      abortActiveGeneration();
      dispatch(host, { type: "ui/rename-started", threadId, draft: threadRenameDraftTitle(thread) });
      void prepareAutoName(threadId);
    },

    updateDraft(threadId: string, value: string): void {
      dispatch(host, { type: "ui/rename-draft-updated", threadId, draft: value });
    },

    cancel(threadId: string): void {
      const current = renameState(host);
      if (current.kind === "saving" && current.threadId === threadId) return;
      abortGeneration(threadId);
      if (activeContextPreparation?.threadId === threadId) activeContextPreparation = null;
      dispatch(host, { type: "ui/rename-cancelled", threadId });
    },

    cancelAutoName(threadId: string): void {
      const current = renameState(host);
      if (current.kind !== "generating" || current.threadId !== threadId) return;
      abortGeneration(threadId);
      dispatch(host, { type: "ui/rename-generation-finished", threadId });
    },

    async save(threadId: string, value: string): Promise<void> {
      const current = renameState(host);
      if (current.kind !== "editing" || current.threadId !== threadId) return;
      dispatch(host, { type: "ui/rename-save-started", threadId });
      if (!renameStillActive(host, threadId, "saving")) return;
      const operation = {};
      activeSave = operation;

      try {
        await host.ensureConnected();
        if (activeSave !== operation || !renameStillActive(host, threadId, "saving")) return;

        await host.renameThread(threadId, value);
        if (activeSave !== operation || !renameStillActive(host, threadId, "saving")) return;
        activeSave = null;
        dispatch(host, { type: "ui/rename-save-succeeded", threadId });
      } catch (error) {
        if (activeSave !== operation || !renameStillActive(host, threadId, "saving")) return;
        activeSave = null;
        host.addSystemMessage(error instanceof Error ? error.message : String(error));
        dispatch(host, { type: "ui/rename-save-failed", threadId });
      }
    },

    async autoNameDraft(threadId: string): Promise<void> {
      const current = renameState(host);
      if (current.kind !== "editing" || current.threadId !== threadId) return;

      dispatch(host, { type: "ui/rename-generation-started", threadId });
      const generating = renameState(host);
      if (generating.kind !== "generating" || generating.threadId !== threadId) return;
      const controller = new AbortController();
      const operation = { threadId, controller };
      activeGeneration = operation;

      try {
        const title = await host.generateThreadTitle(generating.autoName.context, controller.signal);
        if (!title) throw new Error("Codex did not return a usable thread title.");
        if (activeGeneration !== operation) return;
        dispatch(host, { type: "ui/rename-generation-succeeded", threadId, draft: title });
      } catch (error) {
        if (activeGeneration === operation && renameStillActive(host, threadId, "generating")) {
          host.addSystemMessage(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (activeGeneration === operation) {
          activeGeneration = null;
          dispatch(host, { type: "ui/rename-generation-finished", threadId });
        }
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
    if ((current.kind !== "editing" && current.kind !== "saving") || current.threadId !== threadId) return;
    dispatch(host, { type: "ui/rename-auto-name-context-resolved", threadId, context });
  }
}

export function activeThreadRenameTitleContext(state: ChatState, threadId: string): ThreadTitleContext | null {
  return activeThreadId(state) === threadId
    ? firstThreadTitleContextFromThreadStreamItems(threadStreamItems(chatThreadStreamViewState(state.threadStream, state.activeTurn)))
    : null;
}

function renameState(host: ThreadRenameEditorActionsHost): ChatRenameUiState {
  return host.stateStore.getState().ui.rename;
}

function dispatch(host: ThreadRenameEditorActionsHost, action: ChatAction): void {
  host.stateStore.dispatch(action);
}

function renameStillActive(host: ThreadRenameEditorActionsHost, threadId: string, kind: "saving" | "generating"): boolean {
  const state = renameState(host);
  return state.kind === kind && state.threadId === threadId;
}
