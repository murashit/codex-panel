import type { SendShortcut } from "../../../../domain/input/send-shortcut";
import type { ThreadGoal } from "../../../../domain/threads/goal";
import { activePanelOperationDecision } from "../../application/panel-operation-policy";
import type { ChatState } from "../../application/state/model";
import type { GoalCommands } from "../../application/threads/goal-commands";
import type { GoalPanelProps, GoalPanelState } from "../../ui/goal/goal";

export interface ChatPanelGoalDependencies {
  sendShortcut: () => SendShortcut;
  actions: Pick<GoalCommands, "startEditing" | "closeEditor" | "updateObjectiveDraft" | "setObjectiveExpanded"> & {
    saveObjective: (objective: string, tokenBudget: number | null) => Promise<unknown>;
    setStatus: (threadId: string, status: "active" | "paused") => Promise<unknown>;
    clear: (threadId: string) => Promise<unknown>;
  };
}

export function projectChatPanelGoal(model: GoalPanelState, dependencies: ChatPanelGoalDependencies): GoalPanelProps {
  const goal = model.goal;
  const goalThreadId = goal?.threadId ?? null;
  return {
    ...model,
    sendShortcut: dependencies.sendShortcut(),
    actions: {
      onSave: (objective, tokenBudget) => {
        void dependencies.actions.saveObjective(objective, tokenBudget);
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

export function selectChatPanelGoal(state: ChatState, goal: ThreadGoal | null = null): GoalPanelState {
  return {
    goal,
    readOnly: activePanelOperationDecision(state, "goal-mutation").kind !== "allowed",
    editor: state.ui.goalEditor.kind === "editing" ? state.ui.goalEditor : null,
    objectiveExpanded: goal ? state.ui.disclosures.goalObjectiveExpanded.has(goal.threadId) : false,
  };
}
