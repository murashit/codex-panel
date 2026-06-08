import type { AppServerClient } from "../../../app-server/client";
import type { JsonValue } from "../../../generated/app-server/serde_json/JsonValue";
import type { ThreadGoal } from "../../../generated/app-server/v2/ThreadGoal";
import type { ThreadGoalStatus } from "../../../generated/app-server/v2/ThreadGoalStatus";
import type { ChatStateStore } from "../chat-state";
import type { GoalDisplayItem } from "../display/types";
import { goalChangeItem } from "../goal-messages";

export interface ChatThreadGoalActionsHost {
  stateStore: ChatStateStore;
  currentClient: () => AppServerClient | null;
  ensureConnected: () => Promise<void>;
  addSystemMessage: (text: string) => void;
  addGoalEvent: (item: GoalDisplayItem) => void;
  render: () => void;
  refreshLiveState: () => void;
}

export interface ChatThreadGoalActions {
  activeGoal: () => ThreadGoal | null;
  syncThreadGoal: (threadId: string) => Promise<void>;
  setObjective: (threadId: string, objective: string, tokenBudget: number | null) => Promise<boolean>;
  setStatus: (threadId: string, status: ThreadGoalStatus) => Promise<boolean>;
  clear: (threadId: string) => Promise<boolean>;
}

export function createChatThreadGoalActions(host: ChatThreadGoalActionsHost): ChatThreadGoalActions {
  return {
    activeGoal: () => host.stateStore.getState().activeThread.goal,
    syncThreadGoal: (threadId) => syncThreadGoal(host, threadId),
    setObjective: (threadId, objective, tokenBudget) => setObjective(host, threadId, objective, tokenBudget),
    setStatus: (threadId, status) => setGoalStatus(host, threadId, status),
    clear: (threadId) => clearGoal(host, threadId),
  };
}

async function syncThreadGoal(host: ChatThreadGoalActionsHost, threadId: string): Promise<void> {
  const client = host.currentClient();
  if (!client) return;
  try {
    const response = await client.getThreadGoal(threadId);
    applyGoalIfActive(host, threadId, response.goal, { reportChange: false });
  } catch (error) {
    if (host.stateStore.getState().activeThread.id !== threadId) return;
    host.addSystemMessage(`Could not load thread goal: ${errorMessage(error)}`);
  }
}

async function setObjective(
  host: ChatThreadGoalActionsHost,
  threadId: string,
  objective: string,
  tokenBudget: number | null,
): Promise<boolean> {
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

function setGoalStatus(host: ChatThreadGoalActionsHost, threadId: string, status: ThreadGoalStatus): Promise<boolean> {
  return setGoal(host, threadId, { status });
}

async function clearGoal(host: ChatThreadGoalActionsHost, threadId: string): Promise<boolean> {
  await host.ensureConnected();
  const client = host.currentClient();
  if (!client) return false;
  try {
    await client.clearThreadGoal(threadId);
    applyGoalIfActive(host, threadId, null, { reportChange: true });
    return true;
  } catch (error) {
    host.addSystemMessage(errorMessage(error));
    return false;
  }
}

async function setGoal(
  host: ChatThreadGoalActionsHost,
  threadId: string,
  params: { objective?: string | null; status?: ThreadGoalStatus | null; tokenBudget?: number | null },
): Promise<boolean> {
  await host.ensureConnected();
  const client = host.currentClient();
  if (!client) return false;
  try {
    const response = await client.setThreadGoal(threadId, params);
    return applyGoalIfActive(host, threadId, response.goal, { reportChange: true });
  } catch (error) {
    host.addSystemMessage(errorMessage(error));
    return false;
  }
}

function applyGoalIfActive(
  host: ChatThreadGoalActionsHost,
  threadId: string,
  goal: ThreadGoal | null,
  options: { reportChange: boolean },
): boolean {
  const state = host.stateStore.getState();
  if (state.activeThread.id !== threadId) return false;
  const item = options.reportChange ? goalChangeItem(goalEventId(), state.activeThread.goal, goal) : null;
  host.stateStore.dispatch({ type: "active-thread/goal-set", goal });
  if (item) host.addGoalEvent(item);
  host.refreshLiveState();
  host.render();
  return true;
}

async function recordGoalUserMessage(host: ChatThreadGoalActionsHost, threadId: string, objective: string): Promise<void> {
  const client = host.currentClient();
  if (!client) return;
  try {
    await client.injectThreadItems(threadId, [goalUserHistoryItem(objective)]);
  } catch (error) {
    host.addSystemMessage(`Could not record goal message: ${errorMessage(error)}`);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function goalEventId(): string {
  return `goal-${String(Date.now())}-${Math.random().toString(36).slice(2)}`;
}

function goalUserHistoryItem(text: string): JsonValue {
  return {
    type: "message",
    role: "user",
    content: [{ type: "input_text", text }],
  };
}
