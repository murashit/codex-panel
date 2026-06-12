import type { ComponentChild as UiNode } from "preact";
import { h } from "preact";
import { useComputed } from "@preact/signals";

import type { GoalRegionActions, GoalRegionOptions } from "../../ui/goal";
import { goalRegionNode } from "../../ui/goal";
import { useChatPanelShellState } from "../../ui/shell";
import type { ChatPanelGoalPorts } from "./ports";

export function chatPanelGoalRegionNode(ports: ChatPanelGoalPorts): UiNode {
  return h(GoalRegion, { ports });
}

function GoalRegion({ ports }: { ports: ChatPanelGoalPorts }): UiNode {
  const { activeThread, ui, renderVersion, latestState } = useChatPanelShellState();
  const props = useComputed(() => {
    void renderVersion.value;
    return chatPanelGoalProps(ports, {
      ...latestState(),
      activeThread: activeThread.value,
      ui: ui.value,
    });
  });
  return goalRegionNode(props.value.goal, props.value.actions, props.value.options);
}

export function chatPanelGoalProps(
  ports: ChatPanelGoalPorts,
  state: ReturnType<ChatPanelGoalPorts["state"]["chat"]>,
): {
  goal: ReturnType<ChatPanelGoalPorts["state"]["chat"]>["activeThread"]["goal"];
  actions: GoalRegionActions;
  options: GoalRegionOptions;
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
