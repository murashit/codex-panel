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
  refreshLiveState: () => void;
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
  invalidateReads(threadId: string): void;
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

const EMPTY_GOAL_OBJECTIVE_MESSAGE = "Goal objective cannot be empty.";

export function createThreadGoalOperationCoordinator(): ThreadGoalOperationCoordinator {
  const readRevisions = new Map<string, number>();
  return {
    goalMutations: createKeyedOperationQueue(),
    captureReadRevision: (threadId) => readRevisions.get(threadId) ?? 0,
    readRevisionIsCurrent: (threadId, revision) => (readRevisions.get(threadId) ?? 0) === revision,
    invalidateReads: (threadId) => {
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
      enqueueGoalMutation(context, threadId, (panelTarget) => setObjective(context, threadId, objective, tokenBudget, panelTarget)),
    setStatus: (threadId, status) =>
      enqueueGoalMutation(context, threadId, (panelTarget) => setGoalStatus(context, threadId, status, panelTarget)),
    clear: (threadId) => enqueueGoalMutation(context, threadId, (panelTarget) => clearGoal(context, threadId, panelTarget)),
    startEditingCurrent: () => {
      void startEditingCurrent(host);
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
  host: GoalActionsHost,
  threadId: string,
  objective: string,
  tokenBudget: number | null,
  panelTarget?: PanelTargetLease,
): Promise<boolean> {
  const normalized = normalizedGoalObjective(objective);
  if (!normalized) {
    host.addSystemMessage(EMPTY_GOAL_OBJECTIVE_MESSAGE);
    return false;
  }
  return setNormalizedObjective(host, threadId, normalized, tokenBudget, panelTarget);
}

async function setNormalizedObjective(
  host: GoalActionsHost,
  threadId: string,
  objective: NormalizedGoalObjective,
  tokenBudget: number | null,
  panelTarget?: PanelTargetLease,
): Promise<boolean> {
  const current = activeThreadState(host.stateStore.getState())?.goal ?? null;
  const isNewGoal = current === null;
  const applied = await setGoal(
    host,
    threadId,
    {
      objective,
      status: current?.status ?? "active",
      tokenBudget,
    },
    panelTarget,
  );
  if (applied && isNewGoal) {
    await recordGoalUserMessage(host, threadId, objective, panelTarget);
  }
  return applied;
}

async function saveObjective(host: GoalActionsContext, objective: string, tokenBudget: number | null): Promise<boolean> {
  if (!(await prepareGoalMutation(host))) return false;
  const plan = planGoalObjectiveSave(activeThreadId(host.stateStore.getState()), objective, tokenBudget);
  switch (plan.kind) {
    case "reject":
      host.addSystemMessage(plan.message);
      return false;
    case "save-existing":
      return enqueueGoalMutation(host, plan.threadId, (panelTarget) =>
        setNormalizedObjective(host, plan.threadId, plan.objective, plan.tokenBudget, panelTarget),
      );
    case "start-thread-and-save":
      return startThreadAndSaveObjective(host, plan);
  }
}

function setGoalStatus(
  host: GoalActionsHost,
  threadId: string,
  status: ThreadGoalStatus,
  panelTarget?: PanelTargetLease,
): Promise<boolean> {
  return setGoal(host, threadId, { status }, panelTarget);
}

async function clearGoal(host: GoalActionsHost, threadId: string, expectedPanelTarget?: PanelTargetLease): Promise<boolean> {
  if (!(await prepareGoalMutation(host)) || !goalMutationTargetsActiveThread(host, threadId)) return false;
  const panelTarget = expectedPanelTarget ?? capturePanelTargetLease(host.stateStore.getState());
  try {
    if (!(await host.goalTransport.ensureConnected()) || !goalMutationScopeIsCurrent(host, threadId, panelTarget)) return false;
    const effect = await host.goalTransport.clearThreadGoal(threadId);
    if (!effectCompletedInCurrentContext(effect)) return false;
    return applyGoalIfActive(host, threadId, null, { reportChange: true, panelTarget });
  } catch (error) {
    addThreadScopedSystemMessage(host, threadId, errorMessage(error), panelTarget);
    return false;
  }
}

async function setGoal(
  host: GoalActionsHost,
  threadId: string,
  params: ThreadGoalUpdate,
  expectedPanelTarget?: PanelTargetLease,
): Promise<boolean> {
  if (!(await prepareGoalMutation(host)) || !goalMutationTargetsActiveThread(host, threadId)) return false;
  const panelTarget = expectedPanelTarget ?? capturePanelTargetLease(host.stateStore.getState());
  try {
    if (!(await host.goalTransport.ensureConnected()) || !goalMutationScopeIsCurrent(host, threadId, panelTarget)) return false;
    const effect = await host.goalTransport.setThreadGoal(threadId, params);
    if (!effectCompletedInCurrentContext(effect)) return false;
    return applyGoalIfActive(host, threadId, effect.value, { reportChange: true, panelTarget });
  } catch (error) {
    addThreadScopedSystemMessage(host, threadId, errorMessage(error), panelTarget);
    return false;
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
  host.refreshLiveState();
  return true;
}

async function startEditingCurrent(host: GoalActionsHost): Promise<void> {
  if (!(await prepareGoalMutation(host)) || !goalMutationAllowedNow(host)) return;
  host.stateStore.dispatch({ type: "ui/panel-set", panel: null });
  const goal = activeThreadState(host.stateStore.getState())?.goal ?? null;
  startEditing(host, goal?.threadId ?? null, goal?.objective ?? "", goal?.tokenBudget ?? null);
}

async function prepareGoalMutation(host: GoalActionsHost): Promise<boolean> {
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

function goalMutationTargetsActiveThread(host: GoalActionsHost, threadId: string): boolean {
  return activeThreadId(host.stateStore.getState()) === threadId && goalMutationAllowedNow(host);
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
  host: GoalActionsHost,
  plan: Extract<GoalObjectiveSavePlan, { kind: "start-thread-and-save" }>,
): Promise<boolean> {
  try {
    if (!(await host.goalTransport.ensureConnected())) return false;
    if (!emptyPanelCanStartGoalThread(host)) return false;
    const outcome = await host.startThread(plan.objective, { syncGoal: false });
    if (outcome.kind === "created-not-activated") {
      host.addSystemMessage(
        `Created thread ${outcome.threadId}, but the connection changed before it could be opened. Resume it from history before setting its goal.`,
      );
      return false;
    }
    return outcome.kind === "created-activated"
      ? await setNormalizedObjective(host, outcome.threadId, plan.objective, plan.tokenBudget)
      : false;
  } catch (error) {
    host.addSystemMessage(errorMessage(error));
    return false;
  }
}

function emptyPanelCanStartGoalThread(host: GoalActionsHost): boolean {
  const state = host.stateStore.getState();
  return state.panelThread.kind === "empty" && activePanelOperationDecision(state, "goal-mutation").kind === "allowed";
}

async function recordGoalUserMessage(
  host: GoalActionsHost,
  threadId: string,
  objective: string,
  panelTarget?: PanelTargetLease,
): Promise<void> {
  try {
    await host.goalTransport.recordThreadGoalUserMessage(threadId, objective);
  } catch (error) {
    addThreadScopedSystemMessage(host, threadId, `Could not record goal message: ${errorMessage(error)}`, panelTarget);
  }
}

function addThreadScopedSystemMessage(host: ThreadGoalSyncHost, threadId: string, text: string, panelTarget?: PanelTargetLease): void {
  const state = host.stateStore.getState();
  if ((panelTarget && !panelTargetLeaseIsCurrent(state, panelTarget)) || activeThreadId(state) !== threadId) return;
  host.addSystemMessage(text);
}

function goalMutationScopeIsCurrent(host: GoalActionsHost, threadId: string, panelTarget: PanelTargetLease): boolean {
  return panelTargetLeaseIsCurrent(host.stateStore.getState(), panelTarget) && goalMutationTargetsActiveThread(host, threadId);
}

function enqueueGoalMutation(
  host: GoalActionsContext,
  threadId: string,
  operation: (panelTarget: PanelTargetLease) => Promise<boolean>,
): Promise<boolean> {
  const panelTarget = capturePanelTargetLease(host.stateStore.getState());
  host.goalOperations.invalidateReads(threadId);
  return host.goalOperations.goalMutations.run(threadId, async () => {
    try {
      if (!goalMutationScopeIsCurrent(host, threadId, panelTarget)) return false;
      return await operation(panelTarget);
    } finally {
      host.goalOperations.invalidateReads(threadId);
    }
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
