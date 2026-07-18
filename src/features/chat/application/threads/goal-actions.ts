import type { ThreadGoal, ThreadGoalStatus, ThreadGoalUpdate } from "../../../../domain/threads/goal";
import { createKeyedOperationQueue, type KeyedOperationQueue } from "../../../../shared/runtime/keyed-operation-queue";
import { goalChangeItem } from "../../domain/thread-stream/factories/goal-items";
import type { GoalThreadStreamItem } from "../../domain/thread-stream/items";
import { effectCompletedInCurrentContext } from "../effect-outcome";
import type { LocalIdSource } from "../local-id-source";
import { activePanelOperationDecision } from "../panel-operation-policy";
import { capturePanelTargetLease, type PanelTargetLease, panelTargetLeaseIsCurrent } from "../state/panel-target";
import { activeThreadId, activeThreadState } from "../state/root-reducer";
import type { ChatStateStore } from "../state/store";
import type { ThreadGoalReadTransport, ThreadGoalTransport } from "./goal-transport";
import type { ThreadStartOutcome } from "./thread-start-actions";

export interface ThreadGoalSyncHost {
  stateStore: ChatStateStore;
  goalTransport: ThreadGoalReadTransport;
  localItemIds: LocalIdSource;
  addSystemMessage: (text: string) => void;
  addGoalEvent: (item: GoalThreadStreamItem) => void;
}

export interface GoalActionsHost extends ThreadGoalSyncHost {
  goalTransport: ThreadGoalTransport;
  startThread: (preview?: string, options?: { syncGoal?: boolean }) => Promise<ThreadStartOutcome>;
  ensureRestoredThreadLoaded?: () => Promise<boolean>;
}

interface GoalActionsContext extends GoalActionsHost {
  goalOperations: ThreadGoalOperationCoordinator;
}

export interface ThreadGoalOperationCoordinator {
  readonly goalMutations: KeyedOperationQueue<string>;
  captureReadRevision(threadId: string): number;
  readRevisionIsCurrent(threadId: string, revision: number): boolean;
  markMutationCommitted(threadId: string): void;
}

export interface ThreadGoalSyncActions {
  syncThreadGoal: (threadId: string) => Promise<void>;
}

export interface GoalActions extends ThreadGoalSyncActions {
  activeGoal: () => ThreadGoal | null;
  saveObjective: (objective: string, tokenBudget: number | null) => Promise<boolean>;
  setObjective: (threadId: string, objective: string, tokenBudget: number | null) => Promise<boolean>;
  setStatus: (threadId: string, status: ThreadGoalStatus) => Promise<boolean>;
  clear: (threadId: string) => Promise<boolean>;
  startEditingCurrent: () => void;
  startEditing: (threadId: string | null, objective: string, tokenBudget: number | null) => void;
  updateObjectiveDraft: (objective: string) => void;
  setObjectiveExpanded: (threadId: string, expanded: boolean) => void;
  closeEditor: () => void;
}

type GoalObjectiveSavePlan =
  | { kind: "reject"; message: string }
  | { kind: "save-existing"; threadId: string; objective: NormalizedGoalObjective; tokenBudget: number | null }
  | { kind: "start-thread-and-save"; objective: NormalizedGoalObjective; tokenBudget: number | null };

type NormalizedGoalObjective = string & { readonly __brand: "NormalizedGoalObjective" };

interface GoalMutationScope {
  readonly panelTarget: PanelTargetLease;
}

interface GoalMutationOutcome {
  readonly committed: boolean;
  readonly presented: boolean;
}

const EMPTY_GOAL_OBJECTIVE_MESSAGE = "Goal objective cannot be empty.";
const GOAL_MUTATION_NOT_COMMITTED: GoalMutationOutcome = { committed: false, presented: false };

export function createThreadGoalOperationCoordinator(): ThreadGoalOperationCoordinator {
  const readRevisions = new Map<string, number>();
  const goalMutations = createKeyedOperationQueue<string>();
  return {
    goalMutations,
    captureReadRevision: (threadId) => readRevisions.get(threadId) ?? 0,
    readRevisionIsCurrent: (threadId, revision) => (readRevisions.get(threadId) ?? 0) === revision,
    markMutationCommitted: (threadId) => {
      readRevisions.set(threadId, (readRevisions.get(threadId) ?? 0) + 1);
    },
  };
}

export function createThreadGoalSyncActions(
  host: ThreadGoalSyncHost,
  goalOperations: ThreadGoalOperationCoordinator = createThreadGoalOperationCoordinator(),
): ThreadGoalSyncActions {
  return {
    syncThreadGoal: (threadId) => syncThreadGoal(host, threadId, goalOperations),
  };
}

export function createGoalActions(
  host: GoalActionsHost,
  goalOperations: ThreadGoalOperationCoordinator = createThreadGoalOperationCoordinator(),
): GoalActions {
  const context: GoalActionsContext = { ...host, goalOperations };
  return {
    activeGoal: () => activeThreadState(host.stateStore.getState())?.goal ?? null,
    syncThreadGoal: (threadId) => syncThreadGoal(host, threadId, goalOperations),
    saveObjective: (objective, tokenBudget) => saveObjective(context, objective, tokenBudget),
    setObjective: (threadId, objective, tokenBudget) =>
      enqueueGoalMutation(context, threadId, (scope) => setObjective(context, threadId, objective, tokenBudget, scope)),
    setStatus: (threadId, status) => enqueueGoalMutation(context, threadId, (scope) => setGoalStatus(context, threadId, status, scope)),
    clear: (threadId) => enqueueGoalMutation(context, threadId, (scope) => clearGoal(context, threadId, scope)),
    startEditingCurrent: () => {
      void startEditingCurrent(context);
    },
    startEditing: (threadId, objective, tokenBudget) => {
      startEditing(host, threadId, objective, tokenBudget);
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

async function syncThreadGoal(host: ThreadGoalSyncHost, threadId: string, goalOperations: ThreadGoalOperationCoordinator): Promise<void> {
  const panelTarget = capturePanelTargetLease(host.stateStore.getState());
  const readRevision = goalOperations.captureReadRevision(threadId);
  try {
    const goal = await host.goalTransport.readThreadGoal(threadId);
    if (goal === undefined || !goalOperations.readRevisionIsCurrent(threadId, readRevision)) return;
    applyGoalIfActive(host, threadId, goal, { reportChange: false, panelTarget });
  } catch (error) {
    if (!goalOperations.readRevisionIsCurrent(threadId, readRevision)) return;
    addThreadScopedSystemMessage(host, threadId, `Could not load thread goal: ${errorMessage(error)}`, panelTarget);
  }
}

async function setObjective(
  host: GoalActionsContext,
  threadId: string,
  objective: string,
  tokenBudget: number | null,
  scope: GoalMutationScope,
): Promise<boolean> {
  const normalized = normalizedGoalObjective(objective);
  if (!normalized) {
    host.addSystemMessage(EMPTY_GOAL_OBJECTIVE_MESSAGE);
    return false;
  }
  return setNormalizedObjective(host, threadId, normalized, tokenBudget, scope);
}

async function setNormalizedObjective(
  host: GoalActionsContext,
  threadId: string,
  objective: NormalizedGoalObjective,
  tokenBudget: number | null,
  scope: GoalMutationScope,
): Promise<boolean> {
  const current = activeThreadState(host.stateStore.getState())?.goal ?? null;
  const isNewGoal = current === null;
  const outcome = await setGoal(
    host,
    threadId,
    {
      objective,
      status: current?.status ?? "active",
      tokenBudget,
    },
    scope,
  );
  if (outcome.committed && isNewGoal) {
    await recordGoalUserMessage(host, threadId, objective, scope);
  }
  return outcome.presented;
}

async function saveObjective(host: GoalActionsContext, objective: string, tokenBudget: number | null): Promise<boolean> {
  if (!(await prepareGoalMutation(host))) return false;
  const plan = planGoalObjectiveSave(activeThreadId(host.stateStore.getState()), objective, tokenBudget);
  switch (plan.kind) {
    case "reject":
      host.addSystemMessage(plan.message);
      return false;
    case "save-existing":
      return enqueueGoalMutation(host, plan.threadId, (scope) =>
        setNormalizedObjective(host, plan.threadId, plan.objective, plan.tokenBudget, scope),
      );
    case "start-thread-and-save":
      return startThreadAndSaveObjective(host, plan);
  }
}

async function setGoalStatus(
  host: GoalActionsContext,
  threadId: string,
  status: ThreadGoalStatus,
  scope: GoalMutationScope,
): Promise<boolean> {
  return (await setGoal(host, threadId, { status }, scope)).presented;
}

async function clearGoal(host: GoalActionsContext, threadId: string, scope: GoalMutationScope): Promise<boolean> {
  try {
    if (!(await host.goalTransport.ensureConnected()) || !goalMutationAdmissionIsCurrent(host, threadId, scope)) return false;
    const effect = await host.goalTransport.clearThreadGoal(threadId);
    if (!effectCompletedInCurrentContext(effect)) return false;
    host.goalOperations.markMutationCommitted(threadId);
    return applyGoalIfActive(host, threadId, null, { reportChange: true, panelTarget: scope.panelTarget });
  } catch (error) {
    addThreadScopedSystemMessage(host, threadId, errorMessage(error), scope.panelTarget);
    return false;
  }
}

async function setGoal(
  host: GoalActionsContext,
  threadId: string,
  params: ThreadGoalUpdate,
  scope: GoalMutationScope,
): Promise<GoalMutationOutcome> {
  try {
    if (!(await host.goalTransport.ensureConnected()) || !goalMutationAdmissionIsCurrent(host, threadId, scope)) {
      return GOAL_MUTATION_NOT_COMMITTED;
    }
    const effect = await host.goalTransport.setThreadGoal(threadId, params);
    if (!effectCompletedInCurrentContext(effect)) return GOAL_MUTATION_NOT_COMMITTED;
    host.goalOperations.markMutationCommitted(threadId);
    return {
      committed: true,
      presented: applyGoalIfActive(host, threadId, effect.value, { reportChange: true, panelTarget: scope.panelTarget }),
    };
  } catch (error) {
    addThreadScopedSystemMessage(host, threadId, errorMessage(error), scope.panelTarget);
    return GOAL_MUTATION_NOT_COMMITTED;
  }
}

function applyGoalIfActive(
  host: ThreadGoalSyncHost,
  threadId: string,
  goal: ThreadGoal | null,
  options: { reportChange: boolean; panelTarget?: PanelTargetLease },
): boolean {
  const state = host.stateStore.getState();
  if (options.panelTarget && !panelTargetLeaseIsCurrent(state, options.panelTarget)) return false;
  const activeThread = activeThreadState(state);
  if (!activeThread || activeThread.id !== threadId) return false;
  const item = options.reportChange ? goalChangeItem(host.localItemIds.next("goal"), activeThread.goal, goal) : null;
  host.stateStore.dispatch({ type: "active-thread/goal-set", goal });
  if (item) host.addGoalEvent(item);
  return true;
}

async function startEditingCurrent(host: GoalActionsContext): Promise<void> {
  if (!(await prepareGoalMutation(host))) return;
  host.stateStore.dispatch({ type: "ui/panel-set", panel: null });
  const goal = activeThreadState(host.stateStore.getState())?.goal ?? null;
  startEditing(host, goal?.threadId ?? null, goal?.objective ?? "", goal?.tokenBudget ?? null);
}

async function prepareGoalMutation(host: GoalActionsContext): Promise<boolean> {
  const decision = activePanelOperationDecision(host.stateStore.getState(), "goal-mutation");
  if (decision.kind === "allowed") return true;
  if (decision.kind === "blocked") {
    host.addSystemMessage(decision.message);
    return false;
  }
  if (!host.ensureRestoredThreadLoaded || !(await host.ensureRestoredThreadLoaded())) return false;
  const resumedDecision = activePanelOperationDecision(host.stateStore.getState(), "goal-mutation");
  if (resumedDecision.kind === "allowed") return true;
  if (resumedDecision.kind === "blocked") host.addSystemMessage(resumedDecision.message);
  return false;
}

function goalMutationAllowedNow(host: GoalActionsHost): boolean {
  const decision = activePanelOperationDecision(host.stateStore.getState(), "goal-mutation");
  if (decision.kind === "allowed") return true;
  if (decision.kind === "blocked") host.addSystemMessage(decision.message);
  return false;
}

function startEditing(host: GoalActionsHost, threadId: string | null, objective: string, tokenBudget: number | null): void {
  host.stateStore.dispatch({ type: "ui/goal-editor-started", threadId, objective, tokenBudget });
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
  host: GoalActionsContext,
  plan: Extract<GoalObjectiveSavePlan, { kind: "start-thread-and-save" }>,
): Promise<boolean> {
  const panelTarget = capturePanelTargetLease(host.stateStore.getState());
  try {
    if (!(await host.goalTransport.ensureConnected())) return false;
    if (!panelTargetLeaseIsCurrent(host.stateStore.getState(), panelTarget) || !emptyPanelCanStartGoalThread(host)) return false;
    const outcome = await host.startThread(plan.objective, { syncGoal: false });
    if (outcome.kind === "created-not-activated") {
      host.addSystemMessage(
        `Created thread ${outcome.threadId}, but the connection changed before it could be opened. Resume it from history before setting its goal.`,
      );
      return false;
    }
    if (outcome.kind !== "created-activated") return false;
    return await enqueueGoalMutation(host, outcome.threadId, (scope) =>
      setNormalizedObjective(host, outcome.threadId, plan.objective, plan.tokenBudget, scope),
    );
  } catch (error) {
    if (panelTargetLeaseIsCurrent(host.stateStore.getState(), panelTarget)) host.addSystemMessage(errorMessage(error));
    return false;
  }
}

function emptyPanelCanStartGoalThread(host: GoalActionsHost): boolean {
  const state = host.stateStore.getState();
  return state.panelThread.kind === "empty" && activePanelOperationDecision(state, "goal-mutation").kind === "allowed";
}

async function recordGoalUserMessage(
  host: GoalActionsContext,
  threadId: string,
  objective: string,
  scope: GoalMutationScope,
): Promise<void> {
  try {
    await host.goalTransport.recordThreadGoalUserMessage(threadId, objective);
  } catch (error) {
    addThreadScopedSystemMessage(host, threadId, `Could not record goal message: ${errorMessage(error)}`, scope.panelTarget);
  }
}

function addThreadScopedSystemMessage(host: ThreadGoalSyncHost, threadId: string, text: string, panelTarget?: PanelTargetLease): void {
  const state = host.stateStore.getState();
  if ((panelTarget && !panelTargetLeaseIsCurrent(state, panelTarget)) || activeThreadId(state) !== threadId) return;
  host.addSystemMessage(text);
}

function goalMutationPresentationIsCurrent(host: GoalActionsContext, threadId: string, scope: GoalMutationScope): boolean {
  return (
    panelTargetLeaseIsCurrent(host.stateStore.getState(), scope.panelTarget) && activeThreadId(host.stateStore.getState()) === threadId
  );
}

function goalMutationAdmissionIsCurrent(host: GoalActionsContext, threadId: string, scope: GoalMutationScope): boolean {
  return goalMutationPresentationIsCurrent(host, threadId, scope) && goalMutationAllowedNow(host);
}

function enqueueGoalMutation(
  host: GoalActionsContext,
  threadId: string,
  operation: (scope: GoalMutationScope) => Promise<boolean>,
): Promise<boolean> {
  const scope = {
    panelTarget: capturePanelTargetLease(host.stateStore.getState()),
  };
  return host.goalOperations.goalMutations.run(threadId, async () => {
    if (!goalMutationAdmissionIsCurrent(host, threadId, scope)) return false;
    return operation(scope);
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
