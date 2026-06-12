import type { GoalBannerActions, GoalBannerOptions } from "../../ui/goal-banner";
import type { ChatPanelGoalPorts } from "./ports";

export function chatPanelGoalProps(
  ports: ChatPanelGoalPorts,
  state: ReturnType<ChatPanelGoalPorts["state"]["chat"]>,
): {
  goal: ReturnType<ChatPanelGoalPorts["state"]["chat"]>["activeThread"]["goal"];
  actions: GoalBannerActions;
  options: GoalBannerOptions;
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
