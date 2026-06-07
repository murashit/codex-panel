import { renderGoalBanner } from "../../ui/goal-banner";
import type { ChatViewSlotRendererPorts } from "./types";

export function renderGoalSlot(goal: HTMLElement, ports: ChatViewSlotRendererPorts): void {
  const state = ports.state.chat();
  renderGoalBanner(
    goal,
    state.activeThread.goal,
    {
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
    {
      sendShortcut: ports.settings.sendShortcut(),
      editingRequested: state.ui.openDetails.has("goal:editor"),
      onEditingChange: (editing) => {
        ports.actions.goal.setEditingOpen(editing);
      },
    },
  );
}
