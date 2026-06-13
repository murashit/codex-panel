import type { ComponentChild as UiNode } from "preact";
import { h } from "preact";

import type { GoalPanelActions, GoalPanelOptions } from "../../ui/goal";
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
} {
  const goal = state.activeThread.goal;
  const goalThreadId = goal?.threadId ?? null;
  return {
    goal,
    actions: {
      onSave: (objective, tokenBudget) => {
        void ports.actions.goal.saveObjective(objective, tokenBudget);
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
    },
    options: {
      sendShortcut: ports.settings.sendShortcut(),
      editingRequested: state.ui.openDetails.has("goal:editor"),
      onEditingChange: (editing) => {
        ports.actions.goal.setEditingOpen(editing);
      },
    },
  };
}
