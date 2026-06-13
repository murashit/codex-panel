import type { CodexPanelSettings } from "../../../../settings/model";
import type { ChatViewControllers } from "../../controllers";
import { type ChatAction, type ChatState, type ChatStateStore } from "../../state/reducer";
import type { RestoredThreadTitleSnapshot, ChatPanelSurfacePorts } from "./ports";

export interface ChatPanelSurfaceHost {
  settings: CodexPanelSettings;
  vaultPath: string;
  stateStore: ChatStateStore;
  restoredThreadPlaceholder: () => RestoredThreadTitleSnapshot | null;
  startNewThread: () => Promise<void>;
}

export function createChatPanelSurfacePorts(host: ChatPanelSurfaceHost, controllers: ChatViewControllers): ChatPanelSurfacePorts {
  const dispatch = (action: ChatAction): void => {
    host.stateStore.dispatch(action);
  };
  const render = (): void => {
    controllers.render.now();
  };
  const setGoalEditingOpen = (open: boolean, { closeToolbarPanel = false }: { closeToolbarPanel?: boolean } = {}): void => {
    if (closeToolbarPanel) dispatch({ type: "ui/panel-set", panel: null });
    dispatch({ type: "ui/detail-open-set", key: "goal:editor", open });
    render();
  };

  return {
    toolbar: {
      state: {
        connected: () => controllers.connection.manager.isConnected(),
      },
      settings: {
        vaultPath: () => host.vaultPath,
        configuredCommand: () => host.settings.codexPath,
        archiveExportEnabled: () => host.settings.archiveExportEnabled,
      },
      view: {
        toolbar: {
          archiveConfirm: controllers.toolbar.panels.archiveConfirm,
          renameState: (threadId) => controllers.thread.rename.editState(threadId),
          renameVersion: controllers.thread.rename.version,
        },
      },
      actions: {
        toolbar: {
          startNewThread: () => {
            void host.startNewThread();
          },
          toggleChatActions: () => {
            controllers.toolbar.panels.toggleChatActions();
          },
          compactConversation: () => {
            void compactConversation(host.stateStore.getState(), controllers);
          },
          setGoal: () => {
            setGoalEditingOpen(true, { closeToolbarPanel: true });
          },
          toggleHistory: () => {
            controllers.toolbar.panels.toggleHistory();
          },
          toggleStatusPanel: () => {
            controllers.toolbar.panels.toggleStatus();
          },
          connect: () => {
            void controllers.connection.reconnect.reconnectPanel();
          },
          refreshStatus: () => {
            void controllers.connection.controller.refreshStatusPanel();
          },
          resumeThread: (threadId) => {
            void controllers.thread.selection.selectThreadFromToolbar(threadId);
          },
          startArchiveThread: (threadId) => {
            controllers.toolbar.panels.startArchive(threadId);
          },
          archiveThread: (threadId, saveMarkdown) => {
            void controllers.toolbar.panels.archiveThread(threadId, saveMarkdown);
          },
          startRenameThread: (threadId) => {
            controllers.thread.rename.start(threadId);
          },
          updateRenameDraft: (threadId, value) => {
            controllers.thread.rename.updateDraft(threadId, value);
          },
          saveRenameThread: (threadId, value) => {
            void controllers.thread.rename.save(threadId, value);
          },
          cancelRenameThread: (threadId) => {
            controllers.thread.rename.cancel(threadId);
          },
          autoNameThread: (threadId) => {
            void controllers.thread.rename.autoNameDraft(threadId);
          },
        },
      },
    },
    goal: {
      settings: {
        sendShortcut: () => host.settings.sendShortcut,
      },
      actions: {
        goal: {
          saveObjective: (objective, tokenBudget) => saveGoalObjective(host.stateStore.getState(), controllers, objective, tokenBudget),
          setStatus: (threadId, status) => controllers.runtime.goals.setStatus(threadId, status),
          clear: (threadId) => controllers.runtime.goals.clear(threadId),
          setEditingOpen: (open) => {
            setGoalEditingOpen(open);
          },
        },
      },
    },
    composer: {
      thread: {
        restoredPlaceholder: host.restoredThreadPlaceholder,
      },
      runtime: {
        requestModel: (model) => controllers.runtime.settings.requestModelFromUi(model),
        requestReasoningEffort: (effort) => controllers.runtime.settings.requestReasoningEffortFromUi(effort),
        resetReasoningEffortToConfig: () => controllers.runtime.settings.resetReasoningEffortToConfigFromUi(),
      },
    },
  };
}

async function compactConversation(state: ChatState, controllers: ChatViewControllers): Promise<void> {
  const threadId = state.activeThread.id;
  if (!threadId) {
    controllers.inbound.controller.addSystemMessage("No active thread to compact.");
    controllers.render.now();
    return;
  }
  await controllers.thread.actions.compactThread(threadId);
}

async function saveGoalObjective(
  state: ChatState,
  controllers: ChatViewControllers,
  objective: string,
  tokenBudget: number | null,
): Promise<void> {
  let threadId = state.activeThread.id;
  if (!threadId) {
    try {
      await controllers.connection.controller.ensureConnected();
      const response = await controllers.serverActions.threads.startThread(objective, { syncGoal: false });
      threadId = response?.threadId ?? null;
    } catch (error) {
      controllers.inbound.controller.addSystemMessage(error instanceof Error ? error.message : String(error));
      controllers.render.now();
      return;
    }
  }
  if (!threadId) return;
  void controllers.runtime.goals.setObjective(threadId, objective, tokenBudget);
}
