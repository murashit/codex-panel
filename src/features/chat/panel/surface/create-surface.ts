import type { CodexPanelSettings } from "../../../../settings/model";
import type { ConnectionManager } from "../../../../app-server/connection/connection-manager";
import { type ChatAction, type ChatState, type ChatStateStore } from "../../state/reducer";
import type { ChatConnectionController } from "../../connection/connection-controller";
import type { ChatReconnectActions } from "../../connection/reconnect-actions";
import type { ChatInboundController } from "../../protocol/inbound/controller";
import type { ChatServerThreadActions } from "../../connection/server-actions/threads";
import type { ChatThreadActions } from "../../threads/action-context";
import type { ToolbarPanelActions } from "../toolbar-actions";
import type { RenameController } from "../../threads/rename-controller";
import type { SelectionActions } from "../../threads/selection-actions";
import type { ChatRuntimeSettingsActions } from "../../runtime/settings-actions";
import type { GoalActions } from "../../threads/goal-actions";
import type { RestoredThreadTitleSnapshot, ChatPanelSurface } from "./model";

export interface ChatPanelSurfaceHost {
  settings: CodexPanelSettings;
  vaultPath: string;
  stateStore: ChatStateStore;
  restoredThreadPlaceholder: () => RestoredThreadTitleSnapshot | null;
  startNewThread: () => Promise<void>;
}

export interface ChatPanelSurfaceDependencies {
  connection: ConnectionManager;
  connectionController: ChatConnectionController;
  reconnectActions: ChatReconnectActions;
  inboundController: ChatInboundController;
  serverThreads: ChatServerThreadActions;
  threadActions: ChatThreadActions;
  toolbarPanels: ToolbarPanelActions;
  rename: RenameController;
  selection: SelectionActions;
  runtimeSettings: ChatRuntimeSettingsActions;
  goals: GoalActions;
}

export function createChatPanelSurface(host: ChatPanelSurfaceHost, deps: ChatPanelSurfaceDependencies): ChatPanelSurface {
  const dispatch = (action: ChatAction): void => {
    host.stateStore.dispatch(action);
  };
  const startGoalEditing = ({ closeToolbarPanel = false }: { closeToolbarPanel?: boolean } = {}): void => {
    if (closeToolbarPanel) dispatch({ type: "ui/panel-set", panel: null });
    const goal = host.stateStore.getState().activeThread.goal;
    dispatch({
      type: "ui/goal-editor-started",
      threadId: goal?.threadId ?? null,
      objective: goal?.objective ?? "",
      tokenBudget: goal?.tokenBudget ?? null,
    });
  };

  return {
    toolbar: {
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
            startGoalEditing({ closeToolbarPanel: true });
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
    },
    goal: {
      settings: {
        sendShortcut: () => host.settings.sendShortcut,
      },
      actions: {
        goal: {
          saveObjective: (objective, tokenBudget) => saveGoalObjective(host.stateStore.getState(), deps, objective, tokenBudget),
          setStatus: (threadId, status) => deps.goals.setStatus(threadId, status),
          clear: (threadId) => deps.goals.clear(threadId),
          startEditing: (threadId, objective, tokenBudget) => {
            dispatch({ type: "ui/goal-editor-started", threadId, objective, tokenBudget });
          },
          updateObjectiveDraft: (objective) => {
            dispatch({ type: "ui/goal-editor-draft-updated", objective });
          },
          setObjectiveExpanded: (threadId, expanded) => {
            dispatch({ type: "ui/disclosure-set", bucket: "goalObjectiveExpanded", id: threadId, open: expanded });
          },
          closeEditor: () => {
            dispatch({ type: "ui/goal-editor-closed" });
          },
        },
      },
    },
    composer: {
      thread: {
        restoredPlaceholder: host.restoredThreadPlaceholder,
      },
      runtime: {
        requestModel: (model) => deps.runtimeSettings.requestModelFromUi(model),
        requestReasoningEffort: (effort) => deps.runtimeSettings.requestReasoningEffortFromUi(effort),
        resetReasoningEffortToConfig: () => deps.runtimeSettings.resetReasoningEffortToConfigFromUi(),
      },
    },
  };
}

async function compactConversation(state: ChatState, deps: ChatPanelSurfaceDependencies): Promise<void> {
  const threadId = state.activeThread.id;
  if (!threadId) {
    deps.inboundController.addSystemMessage("No active thread to compact.");
    return;
  }
  await deps.threadActions.compactThread(threadId);
}

async function saveGoalObjective(
  state: ChatState,
  deps: ChatPanelSurfaceDependencies,
  objective: string,
  tokenBudget: number | null,
): Promise<void> {
  let threadId = state.activeThread.id;
  if (!threadId) {
    try {
      await deps.connectionController.ensureConnected();
      const response = await deps.serverThreads.startThread(objective, { syncGoal: false });
      threadId = response?.threadId ?? null;
    } catch (error) {
      deps.inboundController.addSystemMessage(error instanceof Error ? error.message : String(error));
      return;
    }
  }
  if (!threadId) return;
  void deps.goals.setObjective(threadId, objective, tokenBudget);
}
