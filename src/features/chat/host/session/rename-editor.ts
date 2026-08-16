import type { Thread } from "../../../../domain/threads/model";
import { threadRenameDraftTitle } from "../../../../domain/threads/title";
import type { ThreadTitleContext } from "../../../../domain/threads/title-generation-model";
import { createThreadRenameEditor, type ThreadRenameEditor } from "../../../threads/workflows/thread-rename-editor";
import { activeThreadId, type ChatState } from "../../application/state/model";
import type { ChatStateStore } from "../../application/state/store";
import { threadStreamItems } from "../../application/state/thread-stream";
import { chatThreadStreamViewState } from "../../application/state/turn-scope";
import { firstThreadTitleContextFromThreadStreamItems } from "../../application/threads/title-context";

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

export interface ThreadRenameEditorActions extends ThreadRenameEditor {
  editState(threadId: string): RenameEditState | null;
  isEditing(): boolean;
}

export function createThreadRenameEditorActions(host: ThreadRenameEditorActionsHost): ThreadRenameEditorActions {
  const editor = createThreadRenameEditor({
    exclusive: true,
    state: {
      get: (threadId) => {
        const state = host.stateStore.getState().ui.rename;
        return state.kind !== "idle" && state.threadId === threadId ? state : undefined;
      },
      replace: (threadId, state) => host.stateStore.dispatch({ type: "ui/rename-set", threadId, state }),
      clear: () => host.stateStore.dispatch({ type: "ui/rename-set", threadId: null, state: undefined }),
    },
    initialDraft: (threadId) => {
      const thread = host.threadById(threadId);
      if (!thread) return null;
      return threadRenameDraftTitle(thread);
    },
    prepare: () => host.ensureConnected(),
    renameThread: (threadId, value) => host.renameThread(threadId, value),
    resolveTitleContext: (threadId) => host.resolveThreadTitleContext(threadId),
    generateTitle: (context, signal) => host.generateThreadTitle(context, signal),
    reportError: (error) => {
      host.addSystemMessage(error instanceof Error ? error.message : String(error));
    },
  });

  return {
    ...editor,
    editState: (threadId) => {
      const state = editorState(threadId);
      return state ? { draft: state.draft, generating: state.kind === "generating" } : null;
    },
    isEditing: () => host.stateStore.getState().ui.rename.kind !== "idle",
  };

  function editorState(threadId: string) {
    const state = host.stateStore.getState().ui.rename;
    return state.kind !== "idle" && state.threadId === threadId ? state : undefined;
  }
}

export function activeThreadRenameTitleContext(state: ChatState, threadId: string): ThreadTitleContext | null {
  return activeThreadId(state) === threadId
    ? firstThreadTitleContextFromThreadStreamItems(threadStreamItems(chatThreadStreamViewState(state.threadStream, state.activeTurn)))
    : null;
}
