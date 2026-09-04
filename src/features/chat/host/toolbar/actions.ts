import { CLIENT_VERSION } from "../../../../constants";
import { diagnosticsWithMetadataResourceProbes } from "../../../../domain/server/diagnostics";
import { copyTextWithNotice } from "../../../../shared/obsidian/clipboard.obsidian";
import type { ChatConnectionCoordinator } from "../../application/connection/connection-coordinator";
import { activeThreadState, type ChatState } from "../../application/state/model";
import type { ChatAction } from "../../application/state/reducer";
import type { ChatStateStore } from "../../application/state/store";
import type { GoalCommands } from "../../application/threads/goal-commands";
import type { ThreadCommands } from "../../application/threads/thread-commands";
import type { ThreadNavigationCommands } from "../../application/threads/thread-navigation-commands";
import type { ToolbarActions } from "../../ui/toolbar";
import type { ThreadRenameEditorActions } from "../session/rename-editor";

interface ToolbarPanelActionsHost {
  stateStore: ChatStateStore;
  threadCommands: ThreadCommands;
}

export interface ToolbarPanelActions {
  toggleHistory(): void;
  toggleChatActions(): void;
  toggleStatus(): void;
  closeForThreadSelection(): void;
  startArchive(threadId: string): void;
  archiveThread(threadId: string, saveMarkdown: boolean): Promise<void>;
  closeOnOutsidePointer(context: ToolbarOutsidePointerContext): void;
}

interface ToolbarUiActionDependencies {
  connectionCoordinator: ChatConnectionCoordinator;
  reconnectCommand: () => Promise<void>;
  threadCommands: ThreadCommands;
  goals: GoalCommands;
  toolbarPanel: ToolbarPanelActions;
  rename: ThreadRenameEditorActions;
  navigation: ThreadNavigationCommands;
  loadMoreThreads: () => Promise<void>;
  openSideChat: () => void;
  debugDetails: {
    stateStore: ChatStateStore;
    connected: () => boolean;
    vaultPath: () => string;
    configuredCommand: () => string;
    runtimeConfig: () => unknown;
    rateLimit: () => unknown;
    availableModels: () => readonly unknown[];
    metadataDiagnostics: () => Parameters<typeof diagnosticsWithMetadataResourceProbes>[1];
  };
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
    toggleHistory(): void {
      dispatch({ type: "ui/panel-set", panel: "history", toggle: true });
    },

    toggleChatActions(): void {
      dispatch({ type: "ui/panel-set", panel: "chat-actions", toggle: true });
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
      await host.threadCommands.archiveThread(threadId, saveMarkdown);
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
      startSideChat: () => {
        deps.openSideChat();
      },
      compactContext: () => {
        void deps.threadCommands.compactActiveThread();
      },
      setGoal: () => {
        deps.goals.startEditingCurrent();
      },
    },
    status: {
      connect: () => {
        void deps.reconnectCommand();
      },
      refreshStatus: () => {
        void deps.connectionCoordinator.refreshStatusPanel();
      },
      copyDebugDetails: () => {
        void copyTextWithNotice(runtimeDebugDetails(deps.debugDetails), "Copied debug details.", "Could not copy debug details.");
      },
    },
    threads: {
      loadMore: () => {
        void deps.loadMoreThreads().catch(() => undefined);
      },
      resume: (threadId) => {
        void deps.navigation.selectThreadFromToolbar(threadId);
      },
      setPinned: (threadId, isPinned) => {
        void deps.threadCommands.setThreadPinned(threadId, isPinned);
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
        cancelAutoName: (threadId) => {
          deps.rename.cancelAutoName(threadId);
        },
        autoName: (threadId) => {
          void deps.rename.autoNameDraft(threadId);
        },
      },
    },
  };
}

function runtimeDebugDetails(input: ToolbarUiActionDependencies["debugDetails"]): string {
  const state = input.stateStore.getState();
  const activeThread = activeThreadState(state);
  const connection = state.connection;
  const serverDiagnostics = diagnosticsWithMetadataResourceProbes(connection.serverDiagnostics, input.metadataDiagnostics());
  return JSON.stringify(
    {
      clientVersion: CLIENT_VERSION,
      vaultPath: input.vaultPath(),
      configuredCommand: input.configuredCommand(),
      activeThreadId: activeThread?.id ?? null,
      connection: {
        connected: input.connected(),
        phase: connection.phase,
        statusText: connection.statusText,
        initializeResponse: connection.initializeResponse,
        rateLimit: input.rateLimit(),
        serverDiagnostics: {
          probes: serverDiagnostics.probes,
          mcpServers: serverDiagnostics.mcpServers,
        },
      },
      runtimeConfig: input.runtimeConfig(),
      runtime: state.runtime,
      availableModels: input.availableModels(),
    },
    null,
    2,
  );
}
