import type { CodexPanelSettings } from "../../../../settings/model";
import type { ChatConnectionController } from "../../application/connection/connection-controller";
import type { ChatInboundController } from "../../app-server/inbound/controller";
import type { GoalActions } from "../../application/threads/goal-actions";
import type { ComponentChild as UiNode } from "preact";
import { h } from "preact";
import type { ChatAction, ChatState } from "../../application/state/root-reducer";
import type { ChatStateStore } from "../../application/state/store";
import type { SendShortcut } from "../../../../shared/ui/keyboard";
import type { GoalPanelActions, GoalPanelDisplayState, GoalPanelEditorState, GoalPanelOptions } from "../../ui/goal";
import { GoalPanel } from "../../ui/goal";
import { goalStateFromShellState, useChatPanelShellState, type ChatPanelGoalShellState } from "../shell-state";

interface ChatPanelGoalActions {
  saveObjective: (objective: string, tokenBudget: number | null) => Promise<void>;
  setStatus: (threadId: string, status: "active" | "paused") => Promise<unknown>;
  clear: (threadId: string) => Promise<unknown>;
  startEditing: (threadId: string | null, objective: string, tokenBudget: number | null) => void;
  updateObjectiveDraft: (objective: string) => void;
  setObjectiveExpanded: (threadId: string, expanded: boolean) => void;
  closeEditor: () => void;
}

export interface ChatPanelGoalSurface {
  settings: {
    sendShortcut: () => SendShortcut;
  };
  actions: {
    goal: ChatPanelGoalActions;
  };
}

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

interface ChatPanelGoalProjection {
  goal: ChatPanelGoalShellState["activeThread"]["goal"];
  goalThreadId: string | null;
  editor: GoalPanelEditorState;
  display: GoalPanelDisplayState;
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

export function ChatPanelGoal({ surface }: { surface: ChatPanelGoalSurface }): UiNode {
  const props = chatPanelGoalViewModel(surface, goalStateFromShellState(useChatPanelShellState()));
  return h(GoalPanel, props);
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

function chatPanelGoalProjection(state: ChatPanelGoalShellState): ChatPanelGoalProjection {
  const goal = state.activeThread.goal;
  const goalThreadId = goal?.threadId ?? null;
  const goalEditor = state.ui.goalEditor;
  const editor =
    goalEditor.kind === "editing"
      ? { editing: true, objectiveDraft: goalEditor.objectiveDraft, tokenBudgetDraft: goalEditor.tokenBudgetDraft }
      : { editing: false, objectiveDraft: goal?.objective ?? "", tokenBudgetDraft: goal?.tokenBudget ?? null };
  return {
    goal,
    goalThreadId,
    editor,
    display: {
      objectiveExpanded: goalThreadId ? state.ui.disclosures.goalObjectiveExpanded.has(goalThreadId) : false,
    },
  };
}

function chatPanelGoalViewModel(
  surface: ChatPanelGoalSurface,
  state: ChatPanelGoalShellState,
): {
  goal: ChatPanelGoalShellState["activeThread"]["goal"];
  actions: GoalPanelActions;
  options: GoalPanelOptions;
  editor: GoalPanelEditorState;
  display: GoalPanelDisplayState;
} {
  const projection = chatPanelGoalProjection(state);
  return {
    goal: projection.goal,
    actions: {
      onSave: (objective, tokenBudget) => {
        void surface.actions.goal.saveObjective(objective, tokenBudget);
        surface.actions.goal.closeEditor();
      },
      onPause: () => {
        if (!projection.goalThreadId) return;
        void surface.actions.goal.setStatus(projection.goalThreadId, "paused");
      },
      onResume: () => {
        if (!projection.goalThreadId) return;
        void surface.actions.goal.setStatus(projection.goalThreadId, "active");
      },
      onClear: () => {
        if (!projection.goalThreadId) return;
        void surface.actions.goal.clear(projection.goalThreadId);
      },
      onStartEditing: () => {
        surface.actions.goal.startEditing(
          projection.goal?.threadId ?? null,
          projection.goal?.objective ?? "",
          projection.goal?.tokenBudget ?? null,
        );
      },
      onCancelEditing: () => {
        surface.actions.goal.closeEditor();
      },
      onObjectiveDraftChange: (objective) => {
        surface.actions.goal.updateObjectiveDraft(objective);
      },
      onObjectiveExpandedChange: (expanded) => {
        if (!projection.goalThreadId) return;
        surface.actions.goal.setObjectiveExpanded(projection.goalThreadId, expanded);
      },
    },
    options: {
      sendShortcut: surface.settings.sendShortcut(),
    },
    editor: projection.editor,
    display: projection.display,
  };
}
