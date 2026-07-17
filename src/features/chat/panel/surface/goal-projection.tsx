import type { ComponentChild as UiNode } from "preact";
import { h } from "preact";
import type { SendShortcut } from "../../../../domain/input/send-shortcut";
import type { GoalPanelActions, GoalPanelDisplayState, GoalPanelEditorState, GoalPanelOptions } from "../../ui/goal";
import { GoalPanel } from "../../ui/goal";
import type { ChatPanelGoalModel } from "../shell-selectors";

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
  sendShortcut: () => SendShortcut;
  actions: ChatPanelGoalActions;
}

export function ChatPanelGoal({ model, surface }: { model: ChatPanelGoalModel; surface: ChatPanelGoalSurface }): UiNode {
  const props = chatPanelGoalViewModel(surface, model);
  return h(GoalPanel, props);
}

interface ChatPanelGoalProjection {
  goal: ChatPanelGoalModel["goal"];
  goalThreadId: string | null;
  editor: GoalPanelEditorState;
  display: GoalPanelDisplayState;
}

function chatPanelGoalProjection(model: ChatPanelGoalModel): ChatPanelGoalProjection {
  const goal = model.goal;
  const goalThreadId = goal?.threadId ?? null;
  const goalEditor = model.goalEditor;
  const editor =
    goalEditor.kind === "editing"
      ? { editing: true, objectiveDraft: goalEditor.objectiveDraft, tokenBudgetDraft: goalEditor.tokenBudgetDraft }
      : { editing: false, objectiveDraft: goal?.objective ?? "", tokenBudgetDraft: goal?.tokenBudget ?? null };
  return {
    goal,
    goalThreadId,
    editor,
    display: {
      objectiveExpanded: goalThreadId ? model.goalObjectiveExpanded.has(goalThreadId) : false,
    },
  };
}

function chatPanelGoalViewModel(
  surface: ChatPanelGoalSurface,
  model: ChatPanelGoalModel,
): {
  goal: ChatPanelGoalModel["goal"];
  actions: GoalPanelActions;
  options: GoalPanelOptions;
  editor: GoalPanelEditorState;
  display: GoalPanelDisplayState;
} {
  const projection = chatPanelGoalProjection(model);
  return {
    goal: projection.goal,
    actions: {
      onSave: (objective, tokenBudget) => {
        void surface.actions.saveObjective(objective, tokenBudget).then((saved) => {
          if (saved) surface.actions.closeEditor();
        });
      },
      onPause: () => {
        if (!projection.goalThreadId) return;
        void surface.actions.setStatus(projection.goalThreadId, "paused");
      },
      onResume: () => {
        if (!projection.goalThreadId) return;
        void surface.actions.setStatus(projection.goalThreadId, "active");
      },
      onClear: () => {
        if (!projection.goalThreadId) return;
        void surface.actions.clear(projection.goalThreadId);
      },
      onStartEditing: () => {
        surface.actions.startEditing(
          projection.goal?.threadId ?? null,
          projection.goal?.objective ?? "",
          projection.goal?.tokenBudget ?? null,
        );
      },
      onCancelEditing: () => {
        surface.actions.closeEditor();
      },
      onObjectiveDraftChange: (objective) => {
        surface.actions.updateObjectiveDraft(objective);
      },
      onObjectiveExpandedChange: (expanded) => {
        if (!projection.goalThreadId) return;
        surface.actions.setObjectiveExpanded(projection.goalThreadId, expanded);
      },
    },
    options: {
      sendShortcut: surface.sendShortcut(),
      readOnly: !model.goalMutationsAllowed,
    },
    editor: projection.editor,
    display: projection.display,
  };
}
