import { goalBannerNode, type GoalBannerActions, type GoalBannerOptions } from "../../ui/goal-banner";
import type { ChatPanelGoalPorts } from "./types";

export function goalPanelNode(ports: ChatPanelGoalPorts) {
  const { goal, actions, options } = goalPanelProps(ports);
  return goalBannerNode(goal, actions, options);
}

function goalPanelProps(ports: ChatPanelGoalPorts): {
  goal: ReturnType<ChatPanelGoalPorts["state"]["chat"]>["activeThread"]["goal"];
  actions: GoalBannerActions;
  options: GoalBannerOptions;
} {
  const state = ports.state.chat();
  return {
    goal: state.activeThread.goal,
    actions: {
      onSave: (objective, tokenBudget) => {
        void ports.actions.goal.saveObjective(objective, tokenBudget);
      },
      onPause: () => {
        const threadId = ports.state.chat().activeThread.id;
        if (!threadId) return;
        void ports.actions.goal.setStatus(threadId, "paused");
      },
      onResume: () => {
        const threadId = ports.state.chat().activeThread.id;
        if (!threadId) return;
        void ports.actions.goal.setStatus(threadId, "active");
      },
      onClear: () => {
        const threadId = ports.state.chat().activeThread.id;
        if (!threadId) return;
        void ports.actions.goal.clear(threadId);
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
