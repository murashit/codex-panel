import type { AppServerClient } from "../../../../app-server/connection/client";
import { readThreadGoal, recordThreadGoalUserMessage, setThreadGoal } from "../../../../app-server/threads";
import type { ThreadGoal, ThreadGoalStatus, ThreadGoalUpdate } from "../../../../domain/threads/goal";
import type { ChatStateStore } from "../state/store";
import type { GoalMessageStreamItem } from "../../domain/message-stream/items";
import { goalChangeItem } from "../../domain/message-stream/factories/goal-items";
import { createLocalChatItemIdFactory } from "../../domain/local-id";

export interface ThreadGoalSyncHost {
  stateStore: ChatStateStore;
  currentClient: () => AppServerClient | null;
  addSystemMessage: (text: string) => void;
  addGoalEvent: (item: GoalMessageStreamItem) => void;
  refreshLiveState: () => void;
}

export interface GoalActionsHost extends ThreadGoalSyncHost {
  ensureConnected: () => Promise<void>;
}

export interface ThreadGoalSyncActions {
  syncThreadGoal: (threadId: string) => Promise<void>;
}

export interface GoalActions extends ThreadGoalSyncActions {
  activeGoal: () => ThreadGoal | null;
  setObjective: (threadId: string, objective: string, tokenBudget: number | null) => Promise<boolean>;
  setStatus: (threadId: string, status: ThreadGoalStatus) => Promise<boolean>;
  clear: (threadId: string) => Promise<boolean>;
}

function emptyGoalObjectiveMessage(): string {
  return "Goal objective cannot be empty.";
}

export function createThreadGoalSyncActions(host: ThreadGoalSyncHost): ThreadGoalSyncActions {
  const localItemIds = createLocalChatItemIdFactory();
  return {
    syncThreadGoal: (threadId) => syncThreadGoal(host, localItemIds, threadId),
  };
}

export function createGoalActions(host: GoalActionsHost): GoalActions {
  const localItemIds = createLocalChatItemIdFactory();
  return {
    activeGoal: () => host.stateStore.getState().activeThread.goal,
    syncThreadGoal: (threadId) => syncThreadGoal(host, localItemIds, threadId),
    setObjective: (threadId, objective, tokenBudget) => setObjective(host, localItemIds, threadId, objective, tokenBudget),
    setStatus: (threadId, status) => setGoalStatus(host, localItemIds, threadId, status),
    clear: (threadId) => clearGoal(host, localItemIds, threadId),
  };
}

async function syncThreadGoal(
  host: ThreadGoalSyncHost,
  localItemIds: ReturnType<typeof createLocalChatItemIdFactory>,
  threadId: string,
): Promise<void> {
  const client = host.currentClient();
  if (!client) return;
  try {
    applyGoalIfActive(host, localItemIds, threadId, await readThreadGoal(client, threadId), { reportChange: false });
  } catch (error) {
    addThreadScopedSystemMessage(host, threadId, `Could not load thread goal: ${errorMessage(error)}`);
  }
}

async function setObjective(
  host: GoalActionsHost,
  localItemIds: ReturnType<typeof createLocalChatItemIdFactory>,
  threadId: string,
  objective: string,
  tokenBudget: number | null,
): Promise<boolean> {
  const trimmed = objective.trim();
  if (!trimmed) {
    host.addSystemMessage(emptyGoalObjectiveMessage());
    return false;
  }
  const current = host.stateStore.getState().activeThread.goal;
  const isNewGoal = current === null;
  const applied = await setGoal(host, localItemIds, threadId, {
    objective: trimmed,
    status: current?.status ?? "active",
    tokenBudget,
  });
  if (applied && isNewGoal) {
    await recordGoalUserMessage(host, threadId, trimmed);
  }
  return applied;
}

function setGoalStatus(
  host: GoalActionsHost,
  localItemIds: ReturnType<typeof createLocalChatItemIdFactory>,
  threadId: string,
  status: ThreadGoalStatus,
): Promise<boolean> {
  return setGoal(host, localItemIds, threadId, { status });
}

async function clearGoal(
  host: GoalActionsHost,
  localItemIds: ReturnType<typeof createLocalChatItemIdFactory>,
  threadId: string,
): Promise<boolean> {
  await host.ensureConnected();
  const client = host.currentClient();
  if (!client) return false;
  try {
    await client.clearThreadGoal(threadId);
    applyGoalIfActive(host, localItemIds, threadId, null, { reportChange: true });
    return true;
  } catch (error) {
    addThreadScopedSystemMessage(host, threadId, errorMessage(error));
    return false;
  }
}

async function setGoal(
  host: GoalActionsHost,
  localItemIds: ReturnType<typeof createLocalChatItemIdFactory>,
  threadId: string,
  params: ThreadGoalUpdate,
): Promise<boolean> {
  await host.ensureConnected();
  const client = host.currentClient();
  if (!client) return false;
  try {
    return applyGoalIfActive(host, localItemIds, threadId, await setThreadGoal(client, threadId, params), { reportChange: true });
  } catch (error) {
    addThreadScopedSystemMessage(host, threadId, errorMessage(error));
    return false;
  }
}

function applyGoalIfActive(
  host: ThreadGoalSyncHost,
  localItemIds: ReturnType<typeof createLocalChatItemIdFactory>,
  threadId: string,
  goal: ThreadGoal | null,
  options: { reportChange: boolean },
): boolean {
  const state = host.stateStore.getState();
  if (state.activeThread.id !== threadId) return false;
  const item = options.reportChange ? goalChangeItem(localItemIds.next("goal"), state.activeThread.goal, goal) : null;
  host.stateStore.dispatch({ type: "active-thread/goal-set", goal });
  if (item) host.addGoalEvent(item);
  host.refreshLiveState();
  return true;
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
