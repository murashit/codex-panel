import type { ComponentChild as UiNode } from "preact";
import { h } from "preact";

import type { GoalPanelActions, GoalPanelDisplayState, GoalPanelEditorState, GoalPanelOptions } from "../../ui/goal";
import { GoalPanel } from "../../ui/goal";
import { goalStateFromShellState, useChatPanelShellState, type ChatPanelGoalShellState } from "../../ui/shell-state";
import type { ChatPanelGoalSurface } from "./model";

export function ChatPanelGoal({ surface }: { surface: ChatPanelGoalSurface }): UiNode {
  const props = chatPanelGoalProps(surface, goalStateFromShellState(useChatPanelShellState()));
  return h(GoalPanel, props);
}

export function chatPanelGoalProps(
  surface: ChatPanelGoalSurface,
  state: ChatPanelGoalShellState,
): {
  goal: ChatPanelGoalShellState["activeThread"]["goal"];
  actions: GoalPanelActions;
  options: GoalPanelOptions;
  editor: GoalPanelEditorState;
  display: GoalPanelDisplayState;
} {
  const goal = state.activeThread.goal;
  const goalThreadId = goal?.threadId ?? null;
  const goalEditor = state.ui.goalEditor;
  const editor =
    goalEditor.kind === "editing"
      ? { editing: true, objectiveDraft: goalEditor.objectiveDraft, tokenBudgetDraft: goalEditor.tokenBudgetDraft }
      : { editing: false, objectiveDraft: goal?.objective ?? "", tokenBudgetDraft: goal?.tokenBudget ?? null };
  return {
    goal,
    actions: {
      onSave: (objective, tokenBudget) => {
        void surface.actions.goal.saveObjective(objective, tokenBudget);
        surface.actions.goal.closeEditor();
      },
      onPause: () => {
        if (!goalThreadId) return;
        void surface.actions.goal.setStatus(goalThreadId, "paused");
      },
      onResume: () => {
        if (!goalThreadId) return;
        void surface.actions.goal.setStatus(goalThreadId, "active");
      },
      onClear: () => {
        if (!goalThreadId) return;
        void surface.actions.goal.clear(goalThreadId);
      },
      onStartEditing: () => {
        surface.actions.goal.startEditing(goal?.threadId ?? null, goal?.objective ?? "", goal?.tokenBudget ?? null);
      },
      onCancelEditing: () => {
        surface.actions.goal.closeEditor();
      },
      onObjectiveDraftChange: (objective) => {
        surface.actions.goal.updateObjectiveDraft(objective);
      },
      onObjectiveExpandedChange: (expanded) => {
        if (!goalThreadId) return;
        surface.actions.goal.setObjectiveExpanded(goalThreadId, expanded);
      },
    },
    options: {
      sendShortcut: surface.settings.sendShortcut(),
    },
    editor,
    display: {
      objectiveExpanded: goalThreadId ? state.ui.disclosures.goalObjectiveExpanded.has(goalThreadId) : false,
    },
  };
}
