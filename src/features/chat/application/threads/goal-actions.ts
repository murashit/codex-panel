import type { ThreadGoal, ThreadGoalStatus, ThreadGoalUpdate } from "../../../../domain/threads/goal";
import type { LocalIdSource } from "../../../../shared/id/local-id";
import { goalChangeItem } from "../../domain/message-stream/factories/goal-items";
import type { GoalMessageStreamItem } from "../../domain/message-stream/items";
import type { ChatStateStore } from "../state/store";
import type { ThreadGoalReadTransport, ThreadGoalTransport } from "./goal-transport";

export interface ThreadGoalSyncHost {
  stateStore: ChatStateStore;
  goalTransport: ThreadGoalReadTransport;
  localItemIds: LocalIdSource;
  addSystemMessage: (text: string) => void;
  addGoalEvent: (item: GoalMessageStreamItem) => void;
  refreshLiveState: () => void;
}

export interface GoalActionsHost extends ThreadGoalSyncHost {
  goalTransport: ThreadGoalTransport;
  startThread: (preview?: string, options?: { syncGoal?: boolean }) => Promise<{ threadId: string } | null>;
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

export function createThreadGoalSyncActions(host: ThreadGoalSyncHost): ThreadGoalSyncActions {
  return {
    syncThreadGoal: (threadId) => syncThreadGoal(host, threadId),
  };
}

export function createGoalActions(host: GoalActionsHost): GoalActions {
  return {
    activeGoal: () => host.stateStore.getState().activeThread.goal,
    syncThreadGoal: (threadId) => syncThreadGoal(host, threadId),
    saveObjective: (objective, tokenBudget) => saveObjective(host, objective, tokenBudget),
    setObjective: (threadId, objective, tokenBudget) => setObjective(host, threadId, objective, tokenBudget),
    setStatus: (threadId, status) => setGoalStatus(host, threadId, status),
    clear: (threadId) => clearGoal(host, threadId),
    startEditingCurrent: () => {
      startEditingCurrent(host);
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

async function syncThreadGoal(host: ThreadGoalSyncHost, threadId: string): Promise<void> {
  try {
    const goal = await host.goalTransport.readThreadGoal(threadId);
    if (goal === undefined) return;
    applyGoalIfActive(host, threadId, goal, { reportChange: false });
  } catch (error) {
    addThreadScopedSystemMessage(host, threadId, `Could not load thread goal: ${errorMessage(error)}`);
  }
}

async function setObjective(host: GoalActionsHost, threadId: string, objective: string, tokenBudget: number | null): Promise<boolean> {
  const normalized = normalizedGoalObjective(objective);
  if (!normalized) {
    host.addSystemMessage(EMPTY_GOAL_OBJECTIVE_MESSAGE);
    return false;
  }
  return setNormalizedObjective(host, threadId, normalized, tokenBudget);
}

async function setNormalizedObjective(
  host: GoalActionsHost,
  threadId: string,
  objective: NormalizedGoalObjective,
  tokenBudget: number | null,
): Promise<boolean> {
  const current = host.stateStore.getState().activeThread.goal;
  const isNewGoal = current === null;
  const applied = await setGoal(host, threadId, {
    objective,
    status: current?.status ?? "active",
    tokenBudget,
  });
  if (applied && isNewGoal) {
    await recordGoalUserMessage(host, threadId, objective);
  }
  return applied;
}

async function saveObjective(host: GoalActionsHost, objective: string, tokenBudget: number | null): Promise<boolean> {
  const plan = planGoalObjectiveSave(host.stateStore.getState().activeThread.id, objective, tokenBudget);
  switch (plan.kind) {
    case "reject":
      host.addSystemMessage(plan.message);
      return false;
    case "save-existing":
      return setNormalizedObjective(host, plan.threadId, plan.objective, plan.tokenBudget);
    case "start-thread-and-save":
      return startThreadAndSaveObjective(host, plan);
  }
}

function setGoalStatus(host: GoalActionsHost, threadId: string, status: ThreadGoalStatus): Promise<boolean> {
  return setGoal(host, threadId, { status });
}

async function clearGoal(host: GoalActionsHost, threadId: string): Promise<boolean> {
  try {
    if (!(await host.goalTransport.clearThreadGoal(threadId))) return false;
    applyGoalIfActive(host, threadId, null, { reportChange: true });
    return true;
  } catch (error) {
    addThreadScopedSystemMessage(host, threadId, errorMessage(error));
    return false;
  }
}

async function setGoal(host: GoalActionsHost, threadId: string, params: ThreadGoalUpdate): Promise<boolean> {
  try {
    const goal = await host.goalTransport.setThreadGoal(threadId, params);
    if (goal === undefined) return false;
    return applyGoalIfActive(host, threadId, goal, { reportChange: true });
  } catch (error) {
    addThreadScopedSystemMessage(host, threadId, errorMessage(error));
    return false;
  }
}

function applyGoalIfActive(
  host: ThreadGoalSyncHost,
  threadId: string,
  goal: ThreadGoal | null,
  options: { reportChange: boolean },
): boolean {
  const state = host.stateStore.getState();
  if (state.activeThread.id !== threadId) return false;
  const item = options.reportChange ? goalChangeItem(host.localItemIds.next("goal"), state.activeThread.goal, goal) : null;
  host.stateStore.dispatch({ type: "active-thread/goal-set", goal });
  if (item) host.addGoalEvent(item);
  host.refreshLiveState();
  return true;
}

function startEditingCurrent(host: GoalActionsHost): void {
  host.stateStore.dispatch({ type: "ui/panel-set", panel: null });
  const goal = host.stateStore.getState().activeThread.goal;
  startEditing(host, goal?.threadId ?? null, goal?.objective ?? "", goal?.tokenBudget ?? null);
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
    const response = await host.startThread(plan.objective, { syncGoal: false });
    const threadId = response?.threadId ?? null;
    return threadId ? await setNormalizedObjective(host, threadId, plan.objective, plan.tokenBudget) : false;
  } catch (error) {
    host.addSystemMessage(errorMessage(error));
    return false;
  }
}

async function recordGoalUserMessage(host: GoalActionsHost, threadId: string, objective: string): Promise<void> {
  try {
    await host.goalTransport.recordThreadGoalUserMessage(threadId, objective);
  } catch (error) {
    addThreadScopedSystemMessage(host, threadId, `Could not record goal message: ${errorMessage(error)}`);
  }
}

function addThreadScopedSystemMessage(host: ThreadGoalSyncHost, threadId: string, text: string): void {
  if (host.stateStore.getState().activeThread.id !== threadId) return;
  host.addSystemMessage(text);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
