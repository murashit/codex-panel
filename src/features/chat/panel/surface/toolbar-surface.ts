import type { CodexPanelSettings } from "../../../../settings/model";
import type { ConnectionManager } from "../../../../app-server/connection/connection-manager";
import type { ChatConnectionController } from "../../connection/connection-controller";
import type { ChatReconnectActions } from "../../connection/reconnect-actions";
import type { ChatInboundController } from "../../app-server/inbound/controller";
import type { ThreadManagementActions } from "../../threads/thread-management-actions";
import type { ToolbarPanelActions } from "../toolbar-actions";
import type { ThreadRenameEditorController } from "../../threads/rename-editor-controller";
import type { SelectionActions } from "../../threads/selection-actions";
import type { ChatStateStore } from "../../state/reducer";
import { noActiveThreadToCompactMessage } from "../../threads/messages";
import type { ChatPanelToolbarSurface } from "./model";

export interface ChatPanelToolbarSurfaceHost {
  settings: CodexPanelSettings;
  vaultPath: string;
  stateStore: ChatStateStore;
  startNewThread: () => Promise<void>;
}

export interface ChatPanelToolbarSurfaceDependencies {
  connection: ConnectionManager;
  connectionController: ChatConnectionController;
  reconnectActions: ChatReconnectActions;
  inboundController: ChatInboundController;
  threadActions: ThreadManagementActions;
  toolbarPanels: ToolbarPanelActions;
  rename: ThreadRenameEditorController;
  selection: SelectionActions;
}

export function createChatPanelToolbarSurface(
  host: ChatPanelToolbarSurfaceHost,
  deps: ChatPanelToolbarSurfaceDependencies,
): ChatPanelToolbarSurface {
  return {
    state: {
      connected: () => deps.connection.isConnected(),
      nowMs: () => Date.now(),
    },
    settings: {
      vaultPath: () => host.vaultPath,
      configuredCommand: () => host.settings.codexPath,
      archiveExportEnabled: () => host.settings.archiveExportEnabled,
    },
    actions: {
      toolbar: {
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
          void deps.reconnectActions.reconnectPanel();
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
      },
    },
  };
}

async function compactConversation(
  state: ReturnType<ChatStateStore["getState"]>,
  deps: Pick<ChatPanelToolbarSurfaceDependencies, "inboundController" | "threadActions">,
): Promise<void> {
  const threadId = state.activeThread.id;
  if (!threadId) {
    deps.inboundController.addSystemMessage(noActiveThreadToCompactMessage());
    return;
  }
  await deps.threadActions.compactThread(threadId);
}
