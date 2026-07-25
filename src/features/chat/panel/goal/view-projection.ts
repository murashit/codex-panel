import type { SendShortcut } from "../../../../domain/input/send-shortcut";
import type { GoalPanelActions, GoalPanelDisplayState, GoalPanelEditorState, GoalPanelOptions } from "../../ui/goal";
import type { ChatPanelGoalModel } from "../shell/selectors";

interface ChatPanelGoalActions {
  saveObjective: (objective: string, tokenBudget: number | null) => Promise<boolean>;
  setStatus: (threadId: string, status: "active" | "paused") => Promise<unknown>;
  clear: (threadId: string) => Promise<unknown>;
  startEditing: (threadId: string | null, objective: string, tokenBudget: number | null) => void;
  updateObjectiveDraft: (objective: string) => void;
  setObjectiveExpanded: (threadId: string, expanded: boolean) => void;
  closeEditor: () => void;
}

export interface ChatPanelGoalDependencies {
  sendShortcut: () => SendShortcut;
  actions: ChatPanelGoalActions;
}

export function projectChatPanelGoal(
  model: ChatPanelGoalModel,
  dependencies: ChatPanelGoalDependencies,
): {
  goal: ChatPanelGoalModel["goal"];
  actions: GoalPanelActions;
  options: GoalPanelOptions;
  editor: GoalPanelEditorState;
  display: GoalPanelDisplayState;
} {
  const goal = model.goal;
  const goalThreadId = goal?.threadId ?? null;
  const goalEditor = model.goalEditor;
  const editor =
    goalEditor.kind === "editing"
      ? { editing: true, objectiveDraft: goalEditor.objectiveDraft, tokenBudgetDraft: goalEditor.tokenBudgetDraft }
      : { editing: false, objectiveDraft: goal?.objective ?? "", tokenBudgetDraft: goal?.tokenBudget ?? null };
  return {
    goal,
    actions: {
      onSave: (objective, tokenBudget) => {
        void dependencies.actions.saveObjective(objective, tokenBudget).then((saved) => {
          if (saved) dependencies.actions.closeEditor();
        });
      },
      onPause: () => {
        if (!goalThreadId) return;
        void dependencies.actions.setStatus(goalThreadId, "paused");
      },
      onResume: () => {
        if (!goalThreadId) return;
        void dependencies.actions.setStatus(goalThreadId, "active");
      },
      onClear: () => {
        if (!goalThreadId) return;
        void dependencies.actions.clear(goalThreadId);
      },
      onStartEditing: () => {
        dependencies.actions.startEditing(goal?.threadId ?? null, goal?.objective ?? "", goal?.tokenBudget ?? null);
      },
      onCancelEditing: () => {
        dependencies.actions.closeEditor();
      },
      onObjectiveDraftChange: (objective) => {
        dependencies.actions.updateObjectiveDraft(objective);
      },
      onObjectiveExpandedChange: (expanded) => {
        if (!goalThreadId) return;
        dependencies.actions.setObjectiveExpanded(goalThreadId, expanded);
      },
    },
    options: {
      sendShortcut: dependencies.sendShortcut(),
      readOnly: !model.goalMutationsAllowed,
    },
    editor,
    display: {
      objectiveExpanded: goalThreadId ? model.goalObjectiveExpanded.has(goalThreadId) : false,
    },
  };
}
