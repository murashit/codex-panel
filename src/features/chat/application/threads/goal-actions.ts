import type { AppServerClient } from "../../../../app-server/connection/client";
import { readThreadGoal, recordThreadGoalUserMessage, setThreadGoal } from "../../../../app-server/threads";
import type { ThreadGoal, ThreadGoalStatus, ThreadGoalUpdate } from "../../../../domain/threads/goal";
import type { LocalIdSource } from "../../../../shared/id/local-id";
import type { ChatStateStore } from "../state/store";
import type { GoalMessageStreamItem } from "../../domain/message-stream/items";
import { goalChangeItem } from "../../domain/message-stream/factories/goal-items";

export interface ThreadGoalSyncHost {
  stateStore: ChatStateStore;
  currentClient: () => AppServerClient | null;
  localItemIds: LocalIdSource;
  addSystemMessage: (text: string) => void;
  addGoalEvent: (item: GoalMessageStreamItem) => void;
  refreshLiveState: () => void;
}

export interface GoalActionsHost extends ThreadGoalSyncHost {
  ensureConnected: () => Promise<void>;
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
  | { kind: "save-existing"; threadId: string; objective: string; tokenBudget: number | null }
  | { kind: "start-thread-and-save"; objective: string; tokenBudget: number | null };

function emptyGoalObjectiveMessage(): string {
  return "Goal objective cannot be empty.";
}

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
  const client = host.currentClient();
  if (!client) return;
  try {
    applyGoalIfActive(host, threadId, await readThreadGoal(client, threadId), { reportChange: false });
  } catch (error) {
    addThreadScopedSystemMessage(host, threadId, `Could not load thread goal: ${errorMessage(error)}`);
  }
}

async function setObjective(host: GoalActionsHost, threadId: string, objective: string, tokenBudget: number | null): Promise<boolean> {
  const normalized = normalizedGoalObjective(objective);
  if (!normalized) {
    host.addSystemMessage(emptyGoalObjectiveMessage());
    return false;
  }
  const current = host.stateStore.getState().activeThread.goal;
  const isNewGoal = current === null;
  const applied = await setGoal(host, threadId, {
    objective: normalized,
    status: current?.status ?? "active",
    tokenBudget,
  });
  if (applied && isNewGoal) {
    await recordGoalUserMessage(host, threadId, normalized);
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
      return setObjective(host, plan.threadId, plan.objective, plan.tokenBudget);
    case "start-thread-and-save":
      return startThreadAndSaveObjective(host, plan);
  }
}

function setGoalStatus(host: GoalActionsHost, threadId: string, status: ThreadGoalStatus): Promise<boolean> {
  return setGoal(host, threadId, { status });
}

async function clearGoal(host: GoalActionsHost, threadId: string): Promise<boolean> {
  await host.ensureConnected();
  const client = host.currentClient();
  if (!client) return false;
  try {
    await client.clearThreadGoal(threadId);
    applyGoalIfActive(host, threadId, null, { reportChange: true });
    return true;
  } catch (error) {
    addThreadScopedSystemMessage(host, threadId, errorMessage(error));
    return false;
  }
}

async function setGoal(host: GoalActionsHost, threadId: string, params: ThreadGoalUpdate): Promise<boolean> {
  await host.ensureConnected();
  const client = host.currentClient();
  if (!client) return false;
  try {
    return applyGoalIfActive(host, threadId, await setThreadGoal(client, threadId, params), { reportChange: true });
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
  if (!normalized) return { kind: "reject", message: emptyGoalObjectiveMessage() };
  return activeThreadId
    ? { kind: "save-existing", threadId: activeThreadId, objective: normalized, tokenBudget }
    : { kind: "start-thread-and-save", objective: normalized, tokenBudget };
}

function normalizedGoalObjective(objective: string): string | null {
  const trimmed = objective.trim();
  return trimmed || null;
}

async function startThreadAndSaveObjective(
  host: GoalActionsHost,
  plan: Extract<GoalObjectiveSavePlan, { kind: "start-thread-and-save" }>,
): Promise<boolean> {
  try {
    await host.ensureConnected();
    const response = await host.startThread(plan.objective, { syncGoal: false });
    const threadId = response?.threadId ?? null;
    return threadId ? await setObjective(host, threadId, plan.objective, plan.tokenBudget) : false;
  } catch (error) {
    host.addSystemMessage(errorMessage(error));
    return false;
  }
}

async function recordGoalUserMessage(host: GoalActionsHost, threadId: string, objective: string): Promise<void> {
  const client = host.currentClient();
  if (!client) return;
  try {
    await recordThreadGoalUserMessage(client, threadId, objective);
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
