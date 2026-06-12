import type { AppServerClient } from "../../../app-server/connection/client";
import {
  appServerThreadGoalUserHistoryItem,
  threadGoalFromAppServerGoal,
  type ThreadGoal,
  type ThreadGoalStatus,
  type ThreadGoalUpdate,
} from "../../../app-server/protocol/thread-goal";
import type { ChatStateStore } from "../state/reducer";
import type { GoalDisplayItem } from "../display/types";
import { goalChangeItem } from "../display/items/goal";

export interface GoalActionsHost {
  stateStore: ChatStateStore;
  currentClient: () => AppServerClient | null;
  ensureConnected: () => Promise<void>;
  addSystemMessage: (text: string) => void;
  addGoalEvent: (item: GoalDisplayItem) => void;
  render: () => void;
  refreshLiveState: () => void;
}

export interface GoalActions {
  activeGoal: () => ThreadGoal | null;
  syncThreadGoal: (threadId: string) => Promise<void>;
  setObjective: (threadId: string, objective: string, tokenBudget: number | null) => Promise<boolean>;
  setStatus: (threadId: string, status: ThreadGoalStatus) => Promise<boolean>;
  clear: (threadId: string) => Promise<boolean>;
}

export function createGoalActions(host: GoalActionsHost): GoalActions {
  return {
    activeGoal: () => host.stateStore.getState().activeThread.goal,
    syncThreadGoal: (threadId) => syncThreadGoal(host, threadId),
    setObjective: (threadId, objective, tokenBudget) => setObjective(host, threadId, objective, tokenBudget),
    setStatus: (threadId, status) => setGoalStatus(host, threadId, status),
    clear: (threadId) => clearGoal(host, threadId),
  };
}

async function syncThreadGoal(host: GoalActionsHost, threadId: string): Promise<void> {
  const client = host.currentClient();
  if (!client) return;
  try {
    const response = await client.getThreadGoal(threadId);
    applyGoalIfActive(host, threadId, threadGoalFromAppServerGoal(response.goal), { reportChange: false });
  } catch (error) {
    addThreadScopedSystemMessage(host, threadId, `Could not load thread goal: ${errorMessage(error)}`);
  }
}

async function setObjective(host: GoalActionsHost, threadId: string, objective: string, tokenBudget: number | null): Promise<boolean> {
  const trimmed = objective.trim();
  if (!trimmed) {
    host.addSystemMessage("Goal objective cannot be empty.");
    return false;
  }
  const current = host.stateStore.getState().activeThread.goal;
  const isNewGoal = current === null;
  const applied = await setGoal(host, threadId, {
    objective: trimmed,
    status: current?.status ?? "active",
    tokenBudget,
  });
  if (applied && isNewGoal) {
    await recordGoalUserMessage(host, threadId, trimmed);
  }
  return applied;
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
    const response = await client.setThreadGoal(threadId, params);
    return applyGoalIfActive(host, threadId, threadGoalFromAppServerGoal(response.goal), { reportChange: true });
  } catch (error) {
    addThreadScopedSystemMessage(host, threadId, errorMessage(error));
    return false;
  }
}

function applyGoalIfActive(host: GoalActionsHost, threadId: string, goal: ThreadGoal | null, options: { reportChange: boolean }): boolean {
  const state = host.stateStore.getState();
  if (state.activeThread.id !== threadId) return false;
  const item = options.reportChange ? goalChangeItem(goalEventId(), state.activeThread.goal, goal) : null;
  host.stateStore.dispatch({ type: "active-thread/goal-set", goal });
  if (item) host.addGoalEvent(item);
  host.refreshLiveState();
  host.render();
  return true;
}

async function recordGoalUserMessage(host: GoalActionsHost, threadId: string, objective: string): Promise<void> {
  const client = host.currentClient();
  if (!client) return;
  try {
    await client.injectThreadItems(threadId, [appServerThreadGoalUserHistoryItem(objective)]);
  } catch (error) {
    addThreadScopedSystemMessage(host, threadId, `Could not record goal message: ${errorMessage(error)}`);
  }
}

function addThreadScopedSystemMessage(host: GoalActionsHost, threadId: string, text: string): void {
  if (host.stateStore.getState().activeThread.id !== threadId) return;
  host.addSystemMessage(text);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function goalEventId(): string {
  return `goal-${String(Date.now())}-${Math.random().toString(36).slice(2)}`;
}
