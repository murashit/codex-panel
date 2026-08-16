import type { ThreadGoal, ThreadGoalStatus, ThreadGoalUpdate } from "../../../../domain/threads/goal";
import type { ThreadGoalCoordinator } from "../../../../domain/threads/goal-coordination";
import type { EffectOutcome } from "../effect-outcome";
import { activePanelOperationDecision } from "../panel-operation-policy";
import { activeThreadId, activeThreadState } from "../state/model";
import { capturePanelTargetLease, panelTargetLeaseIsCurrent } from "../state/panel-target";
import { addThreadGoalSystemMessage, applyThreadGoalIfActive, type ThreadGoalProjectionHost } from "./goal-sync";
import type { ThreadStartOutcome } from "./thread-start-command";

export interface ThreadGoalEffects {
  setThreadGoal(threadId: string, params: ThreadGoalUpdate): Promise<EffectOutcome<ThreadGoal | null>>;
  clearThreadGoal(threadId: string): Promise<EffectOutcome<void>>;
}

export interface GoalCommandsHost extends ThreadGoalProjectionHost {
  effects: ThreadGoalEffects;
  ensureConnected: () => Promise<boolean>;
  startThread: (preview?: string, options?: { syncGoal?: boolean }) => Promise<ThreadStartOutcome>;
  ensureRestoredThreadLoaded: () => Promise<boolean>;
  startEditingGoal: (threadId: string | null, objective: string, tokenBudget: number | null) => void;
}

interface GoalCommandsContext extends GoalCommandsHost {
  goalCoordinator: ThreadGoalCoordinator;
}

export interface GoalCommands {
  activeGoal: () => ThreadGoal | null;
  saveObjective: (objective: string, tokenBudget: number | null) => Promise<boolean>;
  setObjective: (threadId: string, objective: string, tokenBudget: number | null) => Promise<boolean>;
  setStatus: (threadId: string, status: ThreadGoalStatus) => Promise<boolean>;
  clear: (threadId: string) => Promise<boolean>;
  startEditingCurrent: () => void;
}

type GoalObjectiveSavePlan =
  | { kind: "reject"; message: string }
  | { kind: "save-existing"; threadId: string; objective: NormalizedGoalObjective; tokenBudget: number | null }
  | { kind: "start-thread-and-save"; objective: NormalizedGoalObjective; tokenBudget: number | null };

type NormalizedGoalObjective = string & { readonly __brand: "NormalizedGoalObjective" };

const EMPTY_GOAL_OBJECTIVE_MESSAGE = "Goal objective cannot be empty.";

export function createGoalCommands(host: GoalCommandsHost, goalCoordinator: ThreadGoalCoordinator): GoalCommands {
  const context: GoalCommandsContext = { ...host, goalCoordinator };
  return {
    activeGoal: () => activeThreadState(host.stateStore.getState())?.goal ?? null,
    saveObjective: (objective, tokenBudget) => saveObjective(context, objective, tokenBudget),
    setObjective: (threadId, objective, tokenBudget) =>
      enqueueGoalMutation(context, threadId, () => setObjective(context, threadId, objective, tokenBudget)),
    setStatus: (threadId, status) => enqueueGoalMutation(context, threadId, () => setGoalStatus(context, threadId, status)),
    clear: (threadId) => enqueueGoalMutation(context, threadId, () => clearGoal(context, threadId)),
    startEditingCurrent: () => {
      void startEditingCurrent(context);
    },
  };
}

async function setObjective(host: GoalCommandsContext, threadId: string, objective: string, tokenBudget: number | null): Promise<boolean> {
  const normalized = normalizedGoalObjective(objective);
  if (!normalized) {
    host.addSystemMessage(EMPTY_GOAL_OBJECTIVE_MESSAGE);
    return false;
  }
  return setNormalizedObjective(host, threadId, normalized, tokenBudget);
}

async function setNormalizedObjective(
  host: GoalCommandsContext,
  threadId: string,
  objective: NormalizedGoalObjective,
  tokenBudget: number | null,
): Promise<boolean> {
  const current = activeThreadState(host.stateStore.getState())?.goal ?? null;
  return setGoal(host, threadId, {
    objective,
    status: current?.status ?? "active",
    tokenBudget,
  });
}

async function saveObjective(host: GoalCommandsContext, objective: string, tokenBudget: number | null): Promise<boolean> {
  if (!(await prepareGoalMutation(host))) return false;
  const plan = planGoalObjectiveSave(activeThreadId(host.stateStore.getState()), objective, tokenBudget);
  switch (plan.kind) {
    case "reject":
      host.addSystemMessage(plan.message);
      return false;
    case "save-existing":
      return enqueueGoalMutation(host, plan.threadId, () => setNormalizedObjective(host, plan.threadId, plan.objective, plan.tokenBudget));
    case "start-thread-and-save":
      return startThreadAndSaveObjective(host, plan);
  }
}

async function setGoalStatus(host: GoalCommandsContext, threadId: string, status: ThreadGoalStatus): Promise<boolean> {
  return setGoal(host, threadId, { status });
}

async function clearGoal(host: GoalCommandsContext, threadId: string): Promise<boolean> {
  try {
    if (!(await host.ensureConnected()) || !goalMutationAdmissionIsCurrent(host, threadId)) return false;
    const effect = await host.effects.clearThreadGoal(threadId);
    if (effect.kind === "not-started") return false;
    host.goalCoordinator.markAuthoritativeObservation(threadId);
    return applyThreadGoalIfActive(host, threadId, null, { reportChange: true });
  } catch (error) {
    addThreadGoalSystemMessage(host, threadId, errorMessage(error));
    return false;
  }
}

async function setGoal(host: GoalCommandsContext, threadId: string, params: ThreadGoalUpdate): Promise<boolean> {
  try {
    if (!(await host.ensureConnected()) || !goalMutationAdmissionIsCurrent(host, threadId)) {
      return false;
    }
    const effect = await host.effects.setThreadGoal(threadId, params);
    if (effect.kind === "not-started") return false;
    host.goalCoordinator.markAuthoritativeObservation(threadId);
    return applyThreadGoalIfActive(host, threadId, effect.value, { reportChange: true });
  } catch (error) {
    addThreadGoalSystemMessage(host, threadId, errorMessage(error));
    return false;
  }
}

async function startEditingCurrent(host: GoalCommandsContext): Promise<void> {
  if (!(await prepareGoalMutation(host))) return;
  host.stateStore.dispatch({ type: "ui/panel-set", panel: null });
  const goal = activeThreadState(host.stateStore.getState())?.goal ?? null;
  host.startEditingGoal(goal?.threadId ?? null, goal?.objective ?? "", goal?.tokenBudget ?? null);
}

async function prepareGoalMutation(host: GoalCommandsContext): Promise<boolean> {
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
  host: GoalCommandsContext,
  plan: Extract<GoalObjectiveSavePlan, { kind: "start-thread-and-save" }>,
): Promise<boolean> {
  const panelTarget = capturePanelTargetLease(host.stateStore.getState());
  try {
    if (!(await host.ensureConnected())) return false;
    if (!panelTargetLeaseIsCurrent(host.stateStore.getState(), panelTarget) || !emptyPanelCanStartGoalThread(host)) return false;
    const outcome = await host.startThread(plan.objective, { syncGoal: false });
    if (outcome.kind !== "created-activated") return false;
    return await enqueueGoalMutation(host, outcome.threadId, () =>
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

function goalMutationAdmissionIsCurrent(host: GoalCommandsContext, threadId: string): boolean {
  return activeThreadId(host.stateStore.getState()) === threadId && goalMutationAllowedNow(host);
}

function enqueueGoalMutation(host: GoalCommandsContext, threadId: string, operation: () => Promise<boolean>): Promise<boolean> {
  return host.goalCoordinator.runMutation(threadId, async () => {
    if (!goalMutationAdmissionIsCurrent(host, threadId)) return false;
    return operation();
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
