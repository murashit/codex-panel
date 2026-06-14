import type { ComponentChild as UiNode } from "preact";
import { h } from "preact";

import type { GoalPanelActions, GoalPanelDisplayState, GoalPanelEditorState, GoalPanelOptions } from "../../ui/goal";
import { GoalPanel } from "../../ui/goal";
import { goalStateFromShellState, useChatPanelShellState, type ChatPanelGoalShellState } from "../shell-state";
import type { ChatPanelGoalSurface } from "./model";

export interface ChatPanelGoalProjection {
  goal: ChatPanelGoalShellState["activeThread"]["goal"];
  goalThreadId: string | null;
  editor: GoalPanelEditorState;
  display: GoalPanelDisplayState;
}

export function ChatPanelGoal({ surface }: { surface: ChatPanelGoalSurface }): UiNode {
  const props = chatPanelGoalViewModel(surface, goalStateFromShellState(useChatPanelShellState()));
  return h(GoalPanel, props);
}

export function chatPanelGoalProjection(state: ChatPanelGoalShellState): ChatPanelGoalProjection {
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

export function chatPanelGoalViewModel(
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
