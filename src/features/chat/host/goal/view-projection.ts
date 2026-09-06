import type { SendShortcut } from "../../../../domain/input/send-shortcut";
import type { ThreadGoal } from "../../../../domain/threads/goal";
import type { LocalIdSource } from "../../application/local-id-source";
import { activePanelOperationDecision } from "../../application/panel-operation-policy";
import { activeThreadId, type ChatState } from "../../application/state/model";
import type { ChatStateStore } from "../../application/state/store";
import type { GoalCommands } from "../../application/threads/goal-commands";
import { goalChangeItem } from "../../domain/thread-stream/factories/goal-items";
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

export function applyGoalChange(
  stateStore: ChatStateStore,
  localItemIds: LocalIdSource,
  threadId: string,
  previous: ThreadGoal | null,
  next: ThreadGoal | null,
): void {
  const state = stateStore.getState();
  if (activeThreadId(state) !== threadId) return;
  if (goalPresentationChanged(previous, next) && state.ui.disclosures.goalObjectiveExpanded.has(threadId)) {
    stateStore.dispatch({ type: "ui/disclosure-set", bucket: "goalObjectiveExpanded", id: threadId, open: false });
  }
  const item = goalChangeItem(localItemIds.next("goal"), previous, next);
  if (item) stateStore.dispatch({ type: "thread-stream/item-upserted", item });
}

function goalPresentationChanged(previous: ThreadGoal | null, next: ThreadGoal | null): boolean {
  return (
    previous?.threadId !== next?.threadId ||
    previous?.objective !== next?.objective ||
    previous?.status !== next?.status ||
    previous?.tokenBudget !== next?.tokenBudget
  );
}
