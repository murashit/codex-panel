import type { ChatStateStore } from "../state/store";

export interface GoalEditorActionsHost {
  stateStore: ChatStateStore;
}

export interface GoalEditorActions {
  startEditing: (threadId: string | null, objective: string, tokenBudget: number | null) => void;
  updateObjectiveDraft: (objective: string) => void;
  setObjectiveExpanded: (threadId: string, expanded: boolean) => void;
  closeEditor: () => void;
}

export function createGoalEditorActions(host: GoalEditorActionsHost): GoalEditorActions {
  return {
    startEditing: (threadId, objective, tokenBudget) => {
      host.stateStore.dispatch({ type: "ui/goal-editor-started", threadId, objective, tokenBudget });
    },
    updateObjectiveDraft: (objective) => {
      host.stateStore.dispatch({ type: "ui/goal-editor-draft-updated", objective });
    },
    setObjectiveExpanded: (threadId, expanded) => {
      host.stateStore.dispatch({ type: "ui/disclosure-set", bucket: "goalObjectiveExpanded", id: threadId, open: expanded });
    },
    closeEditor: () => {
      host.stateStore.dispatch({ type: "ui/goal-editor-closed" });
    },
  };
}
