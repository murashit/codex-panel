import type { ComponentChild as UiNode } from "preact";
import { h } from "preact";

import type { GoalPanelActions, GoalPanelDisplayState, GoalPanelEditorState, GoalPanelOptions } from "../../ui/goal";
import { GoalPanel } from "../../ui/goal";
import { goalStateFromShellState, useChatPanelShellState, type ChatPanelGoalShellState } from "../../ui/shell-state";
import type { ChatPanelGoalPorts } from "./ports";

export function ChatPanelGoal({ ports }: { ports: ChatPanelGoalPorts }): UiNode {
  const props = chatPanelGoalProps(ports, goalStateFromShellState(useChatPanelShellState()));
  return h(GoalPanel, props);
}

export function chatPanelGoalProps(
  ports: ChatPanelGoalPorts,
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
        void ports.actions.goal.saveObjective(objective, tokenBudget);
        ports.actions.goal.closeEditor();
      },
      onPause: () => {
        if (!goalThreadId) return;
        void ports.actions.goal.setStatus(goalThreadId, "paused");
      },
      onResume: () => {
        if (!goalThreadId) return;
        void ports.actions.goal.setStatus(goalThreadId, "active");
      },
      onClear: () => {
        if (!goalThreadId) return;
        void ports.actions.goal.clear(goalThreadId);
      },
      onStartEditing: () => {
        ports.actions.goal.startEditing(goal?.threadId ?? null, goal?.objective ?? "", goal?.tokenBudget ?? null);
      },
      onCancelEditing: () => {
        ports.actions.goal.closeEditor();
      },
      onObjectiveDraftChange: (objective) => {
        ports.actions.goal.updateObjectiveDraft(objective);
      },
      onObjectiveExpandedChange: (expanded) => {
        if (!goalThreadId) return;
        ports.actions.goal.setObjectiveExpanded(goalThreadId, expanded);
      },
    },
    options: {
      sendShortcut: ports.settings.sendShortcut(),
    },
    editor,
    display: {
      objectiveExpanded: goalThreadId ? state.ui.disclosures.goalObjectiveExpanded.has(goalThreadId) : false,
    },
  };
}
