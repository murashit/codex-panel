import type { CodexPanelSettings } from "../../../../settings/model";
import type { ChatConnectionController } from "../../application/connection/connection-controller";
import type { ChatInboundController } from "../../app-server/inbound/controller";
import type { GoalActions } from "../../application/threads/goal-actions";
import type { ChatAction, ChatState, ChatStateStore } from "../../application/state/reducer";
import type { ChatPanelGoalSurface } from "./model";

export interface ChatPanelGoalSurfaceHost {
  settings: CodexPanelSettings;
  stateStore: ChatStateStore;
}

export interface ChatPanelGoalSurfaceDependencies {
  connectionController: ChatConnectionController;
  inboundController: ChatInboundController;
  threadStarter: ChatPanelGoalThreadStarter;
  goals: GoalActions;
}

interface ChatPanelGoalThreadStarter {
  startThread: (preview?: string, options?: { syncGoal?: boolean }) => Promise<{ threadId: string } | null>;
}

export function createChatPanelGoalSurface(host: ChatPanelGoalSurfaceHost, deps: ChatPanelGoalSurfaceDependencies): ChatPanelGoalSurface {
  const dispatch = (action: ChatAction): void => {
    host.stateStore.dispatch(action);
  };

  return {
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
  };
}

async function saveGoalObjective(
  state: ChatState,
  deps: ChatPanelGoalSurfaceDependencies,
  objective: string,
  tokenBudget: number | null,
): Promise<void> {
  let threadId = state.activeThread.id;
  if (!threadId) {
    try {
      await deps.connectionController.ensureConnected();
      const response = await deps.threadStarter.startThread(objective, { syncGoal: false });
      threadId = response?.threadId ?? null;
    } catch (error) {
      deps.inboundController.addSystemMessage(error instanceof Error ? error.message : String(error));
      return;
    }
  }
  if (!threadId) return;
  void deps.goals.setObjective(threadId, objective, tokenBudget);
}
