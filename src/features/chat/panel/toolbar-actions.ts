import { copyTextWithNotice } from "../../../shared/obsidian/clipboard.obsidian";
import type { ChatConnectionActions } from "../application/connection/connection-actions";
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

export interface ToolbarUiActionDependencies {
  connectionActions: ChatConnectionActions;
  reconnectPanel: () => Promise<void>;
  threadActions: ThreadManagementActions;
  goals: GoalActions;
  toolbarPanel: ToolbarPanelActions;
  rename: ThreadRenameEditorActions;
  navigation: ThreadNavigationActions;
  openSideChat?: () => void;
}

export interface ToolbarOutsidePointerHit {
  insideToolbarPanel: boolean;
  insideArchiveConfirm: boolean;
}

interface ToolbarOutsidePointerContext {
  hit: ToolbarOutsidePointerHit;
  renameEditing: boolean;
}

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

      if (context.hit.insideToolbarPanel) {
        if (archiveConfirmId() && !context.hit.insideArchiveConfirm) {
          setArchiveConfirm(null);
        }
        return;
      }

      if (archiveConfirmId()) {
        setArchiveConfirm(null);
      }

      if (context.renameEditing) return;

      close();
    },
  };
}

export function createToolbarUiActions(deps: ToolbarUiActionDependencies): ToolbarActions {
  return {
    primary: {
      toggleChatActions: () => {
        deps.toolbarPanel.toggleChatActions();
      },
      toggleHistory: () => {
        deps.toolbarPanel.toggleHistory();
      },
      toggleStatusPanel: () => {
        deps.toolbarPanel.toggleStatus();
      },
    },
    chat: {
      startNewThread: () => {
        void deps.navigation.startNewThread();
      },
      ...(deps.openSideChat ? { startSideChat: deps.openSideChat } : {}),
      compactContext: () => {
        void deps.threadActions.compactActiveThread();
      },
      setGoal: () => {
        deps.goals.startEditingCurrent();
      },
    },
    status: {
      connect: () => {
        void deps.reconnectPanel();
      },
      refreshStatus: () => {
        void deps.connectionActions.refreshStatusPanel();
      },
      copyDebugDetails: (details) => {
        void copyTextWithNotice(details, "Copied debug details.", "Could not copy debug details.");
      },
    },
    threads: {
      resume: (threadId) => {
        void deps.navigation.selectThreadFromToolbar(threadId);
      },
      archive: {
        start: (threadId) => {
          deps.toolbarPanel.startArchive(threadId);
        },
        confirm: (threadId, saveMarkdown) => {
          void deps.toolbarPanel.archiveThread(threadId, saveMarkdown);
        },
      },
      rename: {
        start: (threadId) => {
          deps.rename.start(threadId);
        },
        updateDraft: (threadId, value) => {
          deps.rename.updateDraft(threadId, value);
        },
        save: (threadId, value) => {
          void deps.rename.save(threadId, value);
        },
        cancel: (threadId) => {
          deps.rename.cancel(threadId);
        },
        autoName: (threadId) => {
          void deps.rename.autoNameDraft(threadId);
        },
      },
    },
  };
}
