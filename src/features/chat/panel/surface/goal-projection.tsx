import type { ComponentChild as UiNode } from "preact";
import { h } from "preact";
import type { SendShortcut } from "../../../../shared/ui/keyboard";
import type { GoalActions } from "../../application/threads/goal-actions";
import type { GoalPanelActions, GoalPanelDisplayState, GoalPanelEditorState, GoalPanelOptions } from "../../ui/goal";
import { GoalPanel } from "../../ui/goal";
import { type ChatPanelGoalShellState, goalStateFromShellState, useChatPanelShellState } from "../shell-state";

interface ChatPanelGoalActions {
  saveObjective: (objective: string, tokenBudget: number | null) => Promise<boolean>;
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
  sendShortcut: () => SendShortcut;
}

export interface ChatPanelGoalSurfaceDependencies {
  goals: GoalActions;
}

interface ChatPanelGoalProjection {
  goal: ChatPanelGoalShellState["goal"];
  goalThreadId: string | null;
  editor: GoalPanelEditorState;
  display: GoalPanelDisplayState;
}

export function createChatPanelGoalSurface(host: ChatPanelGoalSurfaceHost, deps: ChatPanelGoalSurfaceDependencies): ChatPanelGoalSurface {
  return {
    settings: {
      sendShortcut: host.sendShortcut,
    },
    actions: {
      goal: {
        saveObjective: (objective, tokenBudget) => deps.goals.saveObjective(objective, tokenBudget),
        setStatus: (threadId, status) => deps.goals.setStatus(threadId, status),
        clear: (threadId) => deps.goals.clear(threadId),
        startEditing: (threadId, objective, tokenBudget) => {
          deps.goals.startEditing(threadId, objective, tokenBudget);
        },
        updateObjectiveDraft: (objective) => {
          deps.goals.updateObjectiveDraft(objective);
        },
        setObjectiveExpanded: (threadId, expanded) => {
          deps.goals.setObjectiveExpanded(threadId, expanded);
        },
        closeEditor: () => {
          deps.goals.closeEditor();
        },
      },
    },
  };
}

export function ChatPanelGoal({ surface }: { surface: ChatPanelGoalSurface }): UiNode {
  const props = chatPanelGoalViewModel(surface, goalStateFromShellState(useChatPanelShellState()));
  return h(GoalPanel, props);
}

function chatPanelGoalProjection(state: ChatPanelGoalShellState): ChatPanelGoalProjection {
  const goal = state.goal;
  const goalThreadId = goal?.threadId ?? null;
  const goalEditor = state.goalEditor;
  const editor =
    goalEditor.kind === "editing"
      ? { editing: true, objectiveDraft: goalEditor.objectiveDraft, tokenBudgetDraft: goalEditor.tokenBudgetDraft }
      : { editing: false, objectiveDraft: goal?.objective ?? "", tokenBudgetDraft: goal?.tokenBudget ?? null };
  return {
    goal,
    goalThreadId,
    editor,
    display: {
      objectiveExpanded: goalThreadId ? state.goalObjectiveExpanded.has(goalThreadId) : false,
    },
  };
}

function chatPanelGoalViewModel(
  surface: ChatPanelGoalSurface,
  state: ChatPanelGoalShellState,
): {
  goal: ChatPanelGoalShellState["goal"];
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
        void surface.actions.goal.saveObjective(objective, tokenBudget).then((saved) => {
          if (saved) surface.actions.goal.closeEditor();
        });
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
