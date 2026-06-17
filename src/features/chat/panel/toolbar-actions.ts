import type { ThreadManagementActions } from "../application/threads/thread-management-actions";
import type { ChatAction, ChatState } from "../application/state/root-reducer";
import type { ChatStateStore } from "../application/state/store";
import type { ChatConnectionController } from "../application/connection/connection-controller";
import type { ThreadRenameEditorActions } from "../application/threads/rename-editor-actions";
import type { SelectionActions } from "../application/threads/selection-actions";
import type { ChatInboundController } from "../app-server/inbound/controller";
import type { ToolbarActions } from "../ui/toolbar";

export interface ToolbarPanelActionsHost {
  stateStore: ChatStateStore;
  threadActions: ThreadManagementActions;
}

export interface ToolbarPanelActions {
  archiveConfirmId(): string | null;
  toggleHistory(): void;
  toggleChatActions(): void;
  closeToolbarPanels(): void;
  toggleStatus(): void;
  closeForThreadSelection(): void;
  startArchive(threadId: string): void;
  archiveThread(threadId: string, saveMarkdown: boolean): Promise<void>;
  closeOnOutsidePointer(context: ToolbarOutsidePointerContext): void;
}

export interface ChatPanelToolbarActionsHost {
  stateStore: ChatStateStore;
  startNewThread: () => Promise<void>;
}

export interface ChatPanelToolbarActionDependencies {
  connectionController: ChatConnectionController;
  reconnectPanel: () => Promise<void>;
  inboundController: ChatInboundController;
  threadActions: ThreadManagementActions;
  toolbarPanels: ToolbarPanelActions;
  rename: ThreadRenameEditorActions;
  selection: SelectionActions;
}

interface ToolbarOutsidePointerContext {
  target: EventTarget | null;
  viewWindow: ToolbarDomWindow | null;
  contains: (element: Element) => boolean;
  renameEditing: boolean;
}

type ToolbarDomWindow = Window & { Element: typeof Element };

export function createToolbarPanelActions(host: ToolbarPanelActionsHost): ToolbarPanelActions {
  const state = (): ChatState => host.stateStore.getState();
  const dispatch = (action: ChatAction): void => {
    host.stateStore.dispatch(action);
  };
  const hasOpenPanel = (): boolean => state().ui.toolbarPanel !== null;
  const archiveConfirmId = (): string | null => state().ui.archiveConfirmThreadId;
  const setArchiveConfirm = (threadId: string | null): void => {
    dispatch({ type: "ui/archive-confirm-set", threadId });
  };
  const close = (): void => {
    if (!hasOpenPanel()) return;

    dispatch({ type: "ui/panel-set", panel: null });
    setArchiveConfirm(null);
  };

  return {
    archiveConfirmId(): string | null {
      return archiveConfirmId();
    },

    toggleHistory(): void {
      dispatch({ type: "ui/panel-set", panel: "history", toggle: true });
    },

    toggleChatActions(): void {
      dispatch({ type: "ui/panel-set", panel: "chat-actions", toggle: true });
    },

    closeToolbarPanels(): void {
      close();
    },

    toggleStatus(): void {
      dispatch({ type: "ui/panel-set", panel: "status-panel", toggle: true });
    },

    closeForThreadSelection(): void {
      setArchiveConfirm(null);
    },

    startArchive(threadId: string): void {
      setArchiveConfirm(threadId);
    },

    async archiveThread(threadId: string, saveMarkdown: boolean): Promise<void> {
      if (archiveConfirmId() === threadId) setArchiveConfirm(null);
      await host.threadActions.archiveThread(threadId, saveMarkdown);
    },

    closeOnOutsidePointer(context: ToolbarOutsidePointerContext): void {
      if (!hasOpenPanel()) return;

      const target = context.target;
      if (isToolbarElement(target, context.viewWindow)) {
        const insideToolbarPanel = target.closest(".codex-panel__toolbar-primary, .codex-panel__toolbar-panel");
        if (insideToolbarPanel && context.contains(insideToolbarPanel)) {
          if (archiveConfirmId() && !target.closest(".codex-panel__archive-confirm")) {
            setArchiveConfirm(null);
          }
          return;
        }
      }

      if (archiveConfirmId()) {
        setArchiveConfirm(null);
      }

      if (context.renameEditing) return;

      close();
    },
  };
}

export function createChatPanelToolbarActions(host: ChatPanelToolbarActionsHost, deps: ChatPanelToolbarActionDependencies): ToolbarActions {
  return {
    startNewThread: () => {
      void host.startNewThread();
    },
    toggleChatActions: () => {
      deps.toolbarPanels.toggleChatActions();
    },
    compactConversation: () => {
      void compactConversation(host.stateStore.getState(), deps);
    },
    setGoal: () => {
      host.stateStore.dispatch({ type: "ui/panel-set", panel: null });
      const goal = host.stateStore.getState().activeThread.goal;
      host.stateStore.dispatch({
        type: "ui/goal-editor-started",
        threadId: goal?.threadId ?? null,
        objective: goal?.objective ?? "",
        tokenBudget: goal?.tokenBudget ?? null,
      });
    },
    toggleHistory: () => {
      deps.toolbarPanels.toggleHistory();
    },
    toggleStatusPanel: () => {
      deps.toolbarPanels.toggleStatus();
    },
    connect: () => {
      void deps.reconnectPanel();
    },
    refreshStatus: () => {
      void deps.connectionController.refreshStatusPanel();
    },
    resumeThread: (threadId) => {
      void deps.selection.selectThreadFromToolbar(threadId);
    },
    startArchiveThread: (threadId) => {
      deps.toolbarPanels.startArchive(threadId);
    },
    archiveThread: (threadId, saveMarkdown) => {
      void deps.toolbarPanels.archiveThread(threadId, saveMarkdown);
    },
    startRenameThread: (threadId) => {
      deps.rename.start(threadId);
    },
    updateRenameDraft: (threadId, value) => {
      deps.rename.updateDraft(threadId, value);
    },
    saveRenameThread: (threadId, value) => {
      void deps.rename.save(threadId, value);
    },
    cancelRenameThread: (threadId) => {
      deps.rename.cancel(threadId);
    },
    autoNameThread: (threadId) => {
      void deps.rename.autoNameDraft(threadId);
    },
  };
}

async function compactConversation(
  state: ReturnType<ChatStateStore["getState"]>,
  deps: Pick<ChatPanelToolbarActionDependencies, "inboundController" | "threadActions">,
): Promise<void> {
  const threadId = state.activeThread.id;
  if (!threadId) {
    deps.inboundController.addSystemMessage("No active thread to compact.");
    return;
  }
  await deps.threadActions.compactThread(threadId);
}

function isToolbarElement(target: EventTarget | null, viewWindow: ToolbarDomWindow | null): target is Element {
  return Boolean(viewWindow && target instanceof viewWindow.Element);
}
