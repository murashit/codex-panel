import type { SendShortcut } from "../../../../domain/input/send-shortcut";
import type { GoalPanelProps, GoalPanelState } from "../../ui/goal/goal";

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

export function projectChatPanelGoal(model: GoalPanelState, dependencies: ChatPanelGoalDependencies): GoalPanelProps {
  const goal = model.goal;
  const goalThreadId = goal?.threadId ?? null;
  return {
    ...model,
    sendShortcut: dependencies.sendShortcut(),
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
  };
}
