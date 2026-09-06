import type { ThreadGoal, ThreadGoalStatus, ThreadGoalUpdate } from "../../../../domain/threads/goal";
import type { EffectOutcome } from "../effect-outcome";
import { activePanelOperationDecision } from "../panel-operation-policy";
import { activeThreadId } from "../state/model";
import { capturePanelTargetLease, panelTargetLeaseIsCurrent } from "../state/panel-target";
import type { ChatStateStore } from "../state/store";
import type { ThreadStartOutcome } from "./thread-start-command";

export interface ThreadGoalEffects {
  setThreadGoal(threadId: string, params: ThreadGoalUpdate): Promise<EffectOutcome<void>>;
  clearThreadGoal(threadId: string): Promise<EffectOutcome<void>>;
}

export interface GoalCommandsHost {
  stateStore: ChatStateStore;
  addSystemMessage: (text: string) => void;
  effects: ThreadGoalEffects;
  goalQueries: {
    snapshot(threadId: string): ThreadGoal | null | undefined;
  };
  ensureConnected: () => Promise<boolean>;
  startThread: (preview?: string) => Promise<ThreadStartOutcome>;
  ensureRestoredThreadLoaded: () => Promise<boolean>;
}

export interface GoalCommands {
  activeGoal: () => ThreadGoal | null;
  saveObjective: (objective: string, tokenBudget: number | null) => Promise<boolean>;
  setObjective: (threadId: string, objective: string, tokenBudget: number | null) => Promise<boolean>;
  setStatus: (threadId: string, status: ThreadGoalStatus) => Promise<boolean>;
  clear: (threadId: string) => Promise<boolean>;
  startEditingCurrent: () => void;
  startEditing: (threadId: string | null, objective: string, tokenBudget: number | null) => void;
  updateObjectiveDraft: (objective: string) => void;
  closeEditor: () => void;
  setObjectiveExpanded: (threadId: string, expanded: boolean) => void;
}

type GoalObjectiveSavePlan =
  | { kind: "reject"; message: string }
  | { kind: "save-existing"; threadId: string; objective: NormalizedGoalObjective; tokenBudget: number | null }
  | { kind: "start-thread-and-save"; objective: NormalizedGoalObjective; tokenBudget: number | null };

type NormalizedGoalObjective = string & { readonly __brand: "NormalizedGoalObjective" };

const EMPTY_GOAL_OBJECTIVE_MESSAGE = "Goal objective cannot be empty.";

export function createGoalCommands(host: GoalCommandsHost): GoalCommands {
  return {
    activeGoal: () => currentGoal(host),
    saveObjective: async (objective, tokenBudget) => {
      const editor = host.stateStore.getState().ui.goalEditor;
      const saved = await saveObjective(host, objective, tokenBudget);
      if (saved && editor.kind === "editing" && host.stateStore.getState().ui.goalEditor === editor) {
        host.stateStore.dispatch({ type: "ui/goal-editor-closed" });
      }
      return saved;
    },
    startEditing: (threadId, objective, tokenBudget) => {
      host.stateStore.dispatch({ type: "ui/goal-editor-started", threadId, objective, tokenBudget });
    },
    updateObjectiveDraft: (objective) => {
      host.stateStore.dispatch({ type: "ui/goal-editor-draft-updated", objective });
    },
    closeEditor: () => {
      host.stateStore.dispatch({ type: "ui/goal-editor-closed" });
    },
    setObjectiveExpanded: (threadId, expanded) => {
      host.stateStore.dispatch({ type: "ui/disclosure-set", bucket: "goalObjectiveExpanded", id: threadId, open: expanded });
    },
    setObjective: (threadId, objective, tokenBudget) =>
      runGoalMutation(host, threadId, () => setObjective(host, threadId, objective, tokenBudget)),
    setStatus: (threadId, status) => runGoalMutation(host, threadId, () => setGoalStatus(host, threadId, status)),
    clear: (threadId) => runGoalMutation(host, threadId, () => clearGoal(host, threadId)),
    startEditingCurrent: () => {
      void startEditingCurrent(host);
    },
  };
}

async function setObjective(host: GoalCommandsHost, threadId: string, objective: string, tokenBudget: number | null): Promise<boolean> {
  const normalized = normalizedGoalObjective(objective);
  if (!normalized) {
    host.addSystemMessage(EMPTY_GOAL_OBJECTIVE_MESSAGE);
    return false;
  }
  return setNormalizedObjective(host, threadId, normalized, tokenBudget);
}

async function setNormalizedObjective(
  host: GoalCommandsHost,
  threadId: string,
  objective: NormalizedGoalObjective,
  tokenBudget: number | null,
): Promise<boolean> {
  const current = currentGoal(host);
  return setGoal(host, threadId, {
    objective,
    status: current?.status ?? "active",
    tokenBudget,
  });
}

async function saveObjective(host: GoalCommandsHost, objective: string, tokenBudget: number | null): Promise<boolean> {
  const panelTarget = capturePanelTargetLease(host.stateStore.getState());
  if (!(await prepareGoalMutation(host)) || !panelTargetLeaseIsCurrent(host.stateStore.getState(), panelTarget)) return false;
  const plan = planGoalObjectiveSave(activeThreadId(host.stateStore.getState()), objective, tokenBudget);
  switch (plan.kind) {
    case "reject":
      host.addSystemMessage(plan.message);
      return false;
    case "save-existing":
      return runGoalMutation(host, plan.threadId, () => setNormalizedObjective(host, plan.threadId, plan.objective, plan.tokenBudget));
    case "start-thread-and-save":
      return startThreadAndSaveObjective(host, plan);
  }
}

async function setGoalStatus(host: GoalCommandsHost, threadId: string, status: ThreadGoalStatus): Promise<boolean> {
  return setGoal(host, threadId, { status });
}

async function clearGoal(host: GoalCommandsHost, threadId: string): Promise<boolean> {
  try {
    if (!(await host.ensureConnected()) || !goalMutationAdmissionIsCurrent(host, threadId)) return false;
    const effect = await host.effects.clearThreadGoal(threadId);
    if (effect.kind === "not-started") return false;
    return activeThreadId(host.stateStore.getState()) === threadId;
  } catch (error) {
    addThreadGoalSystemMessage(host, threadId, errorMessage(error));
    return false;
  }
}

async function setGoal(host: GoalCommandsHost, threadId: string, params: ThreadGoalUpdate): Promise<boolean> {
  try {
    if (!(await host.ensureConnected()) || !goalMutationAdmissionIsCurrent(host, threadId)) {
      return false;
    }
    const effect = await host.effects.setThreadGoal(threadId, params);
    if (effect.kind === "not-started") return false;
    return activeThreadId(host.stateStore.getState()) === threadId;
  } catch (error) {
    addThreadGoalSystemMessage(host, threadId, errorMessage(error));
    return false;
  }
}

async function startEditingCurrent(host: GoalCommandsHost): Promise<void> {
  if (!(await prepareGoalMutation(host))) return;
  host.stateStore.dispatch({ type: "ui/panel-set", panel: null });
  const goal = currentGoal(host);
  host.stateStore.dispatch({
    type: "ui/goal-editor-started",
    threadId: goal?.threadId ?? null,
    objective: goal?.objective ?? "",
    tokenBudget: goal?.tokenBudget ?? null,
  });
}

async function prepareGoalMutation(host: GoalCommandsHost): Promise<boolean> {
  const decision = activePanelOperationDecision(host.stateStore.getState(), "goal-mutation");
  if (decision.kind === "allowed") return true;
  if (decision.kind === "blocked") {
    host.addSystemMessage(decision.message);
    return false;
  }
  if (!(await host.ensureRestoredThreadLoaded())) return false;
  const resumedDecision = activePanelOperationDecision(host.stateStore.getState(), "goal-mutation");
  if (resumedDecision.kind === "allowed") return true;
  if (resumedDecision.kind === "blocked") host.addSystemMessage(resumedDecision.message);
  return false;
}

function goalMutationAllowedNow(host: GoalCommandsHost): boolean {
  const decision = activePanelOperationDecision(host.stateStore.getState(), "goal-mutation");
  if (decision.kind === "allowed") return true;
  if (decision.kind === "blocked") host.addSystemMessage(decision.message);
  return false;
}

function planGoalObjectiveSave(activeThreadId: string | null, objective: string, tokenBudget: number | null): GoalObjectiveSavePlan {
  const normalized = normalizedGoalObjective(objective);
  if (!normalized) return { kind: "reject", message: EMPTY_GOAL_OBJECTIVE_MESSAGE };
  return activeThreadId
    ? { kind: "save-existing", threadId: activeThreadId, objective: normalized, tokenBudget }
    : { kind: "start-thread-and-save", objective: normalized, tokenBudget };
}

function normalizedGoalObjective(objective: string): NormalizedGoalObjective | null {
  const trimmed = objective.trim();
  return trimmed ? (trimmed as NormalizedGoalObjective) : null;
}

async function startThreadAndSaveObjective(
  host: GoalCommandsHost,
  plan: Extract<GoalObjectiveSavePlan, { kind: "start-thread-and-save" }>,
): Promise<boolean> {
  const panelTarget = capturePanelTargetLease(host.stateStore.getState());
  try {
    if (!(await host.ensureConnected())) return false;
    if (!panelTargetLeaseIsCurrent(host.stateStore.getState(), panelTarget) || !emptyPanelCanStartGoalThread(host)) return false;
    const outcome = await host.startThread(plan.objective);
    if (outcome.kind !== "created-activated") return false;
    return await runGoalMutation(host, outcome.threadId, () =>
      setNormalizedObjective(host, outcome.threadId, plan.objective, plan.tokenBudget),
    );
  } catch (error) {
    if (panelTargetLeaseIsCurrent(host.stateStore.getState(), panelTarget)) host.addSystemMessage(errorMessage(error));
    return false;
  }
}

function emptyPanelCanStartGoalThread(host: GoalCommandsHost): boolean {
  const state = host.stateStore.getState();
  return state.panelThread.kind === "empty" && activePanelOperationDecision(state, "goal-mutation").kind === "allowed";
}

function goalMutationAdmissionIsCurrent(host: GoalCommandsHost, threadId: string): boolean {
  return activeThreadId(host.stateStore.getState()) === threadId && goalMutationAllowedNow(host);
}

function runGoalMutation(host: GoalCommandsHost, threadId: string, operation: () => Promise<boolean>): Promise<boolean> {
  if (!goalMutationAdmissionIsCurrent(host, threadId)) return Promise.resolve(false);
  return operation();
}

function currentGoal(host: GoalCommandsHost): ThreadGoal | null {
  const threadId = activeThreadId(host.stateStore.getState());
  return threadId ? (host.goalQueries.snapshot(threadId) ?? null) : null;
}

function addThreadGoalSystemMessage(host: GoalCommandsHost, threadId: string, text: string): void {
  if (activeThreadId(host.stateStore.getState()) === threadId) host.addSystemMessage(text);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
