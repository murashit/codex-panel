import type { SendShortcut } from "../../../../domain/input/send-shortcut";
import type { ChatStateStore } from "../../application/state/store";
import type { GoalPanelProps, GoalPanelState } from "../../ui/goal/goal";

interface ChatPanelGoalActions extends ReturnType<typeof createGoalEditorActions> {
  saveObjective: (objective: string, tokenBudget: number | null) => Promise<boolean>;
  setStatus: (threadId: string, status: "active" | "paused") => Promise<unknown>;
  clear: (threadId: string) => Promise<unknown>;
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

export function createGoalEditorActions(stateStore: ChatStateStore) {
  return {
    startEditing: (threadId: string | null, objective: string, tokenBudget: number | null) => {
      stateStore.dispatch({ type: "ui/goal-editor-started", threadId, objective, tokenBudget });
    },
    updateObjectiveDraft: (objective: string) => {
      stateStore.dispatch({ type: "ui/goal-editor-draft-updated", objective });
    },
    setObjectiveExpanded: (threadId: string, expanded: boolean) => {
      stateStore.dispatch({ type: "ui/disclosure-set", bucket: "goalObjectiveExpanded", id: threadId, open: expanded });
    },
    closeEditor: () => {
      stateStore.dispatch({ type: "ui/goal-editor-closed" });
    },
  };
}
