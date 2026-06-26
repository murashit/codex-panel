import { copyTextWithNotice } from "../../../shared/ui/clipboard";
import type { ChatConnectionController } from "../application/connection/connection-controller";
import type { ChatAction, ChatState } from "../application/state/root-reducer";
import type { ChatStateStore } from "../application/state/store";
import type { GoalActions } from "../application/threads/goal-actions";
import type { ThreadRenameEditorActions } from "../application/threads/rename-editor-actions";
import type { ThreadManagementActions } from "../application/threads/thread-management-actions";
import type { ThreadNavigationActions } from "../application/threads/thread-navigation-actions";
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

export interface ChatPanelToolbarActionDependencies {
  connectionController: ChatConnectionController;
  reconnectPanel: () => Promise<void>;
  threadActions: ThreadManagementActions;
  goals: GoalActions;
  toolbarPanels: ToolbarPanelActions;
  rename: ThreadRenameEditorActions;
  navigation: ThreadNavigationActions;
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

export function createChatPanelToolbarActions(deps: ChatPanelToolbarActionDependencies): ToolbarActions {
  return {
    startNewThread: () => {
      void deps.navigation.startNewThread();
    },
    toggleChatActions: () => {
      deps.toolbarPanels.toggleChatActions();
    },
    compactConversation: () => {
      void deps.threadActions.compactActiveThread();
    },
    setGoal: () => {
      deps.goals.startEditingCurrent();
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
    copyDebugDetails: (details) => {
      void copyTextWithNotice(details, "Copied debug details.", "Could not copy debug details.");
    },
    resumeThread: (threadId) => {
      void deps.navigation.selectThreadFromToolbar(threadId);
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

function isToolbarElement(target: EventTarget | null, viewWindow: ToolbarDomWindow | null): target is Element {
  return Boolean(viewWindow && target instanceof viewWindow.Element);
}
