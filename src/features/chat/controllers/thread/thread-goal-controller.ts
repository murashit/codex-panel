import type { AppServerClient } from "../../../../app-server/client";
import type { JsonValue } from "../../../../generated/app-server/serde_json/JsonValue";
import type { ThreadGoal } from "../../../../generated/app-server/v2/ThreadGoal";
import type { ThreadGoalStatus } from "../../../../generated/app-server/v2/ThreadGoalStatus";
import type { ChatStateStore } from "../../chat-state";
import type { GoalDisplayItem } from "../../display/types";
import { goalChangeItem } from "../../goal-messages";

export interface ChatThreadGoalControllerHost {
  stateStore: ChatStateStore;
  currentClient: () => AppServerClient | null;
  ensureConnected: () => Promise<void>;
  addSystemMessage: (text: string) => void;
  addGoalEvent: (item: GoalDisplayItem) => void;
  render: () => void;
  refreshLiveState: () => void;
}

export class ChatThreadGoalController {
  constructor(private readonly host: ChatThreadGoalControllerHost) {}

  activeGoal(): ThreadGoal | null {
    return this.host.stateStore.getState().activeThread.goal;
  }

  async syncThreadGoal(threadId: string): Promise<void> {
    const client = this.host.currentClient();
    if (!client) return;
    try {
      const response = await client.getThreadGoal(threadId);
      this.applyGoalIfActive(threadId, response.goal, { reportChange: false });
    } catch (error) {
      if (this.host.stateStore.getState().activeThread.id !== threadId) return;
      this.host.addSystemMessage(`Could not load thread goal: ${errorMessage(error)}`);
    }
  }

  async setObjective(threadId: string, objective: string, tokenBudget: number | null): Promise<boolean> {
    const trimmed = objective.trim();
    if (!trimmed) {
      this.host.addSystemMessage("Goal objective cannot be empty.");
      return false;
    }
    const current = this.host.stateStore.getState().activeThread.goal;
    const isNewGoal = current === null;
    const applied = await this.setGoal(threadId, {
      objective: trimmed,
      status: current?.status ?? "active",
      tokenBudget,
    });
    if (applied && isNewGoal) {
      await this.recordGoalUserMessage(threadId, trimmed);
    }
    return applied;
  }

  async setStatus(threadId: string, status: ThreadGoalStatus): Promise<boolean> {
    return this.setGoal(threadId, { status });
  }

  async clear(threadId: string): Promise<boolean> {
    await this.host.ensureConnected();
    const client = this.host.currentClient();
    if (!client) return false;
    try {
      await client.clearThreadGoal(threadId);
      this.applyGoalIfActive(threadId, null, { reportChange: true });
      return true;
    } catch (error) {
      this.host.addSystemMessage(errorMessage(error));
      return false;
    }
  }

  private async setGoal(
    threadId: string,
    params: { objective?: string | null; status?: ThreadGoalStatus | null; tokenBudget?: number | null },
  ): Promise<boolean> {
    await this.host.ensureConnected();
    const client = this.host.currentClient();
    if (!client) return false;
    try {
      const response = await client.setThreadGoal(threadId, params);
      return this.applyGoalIfActive(threadId, response.goal, { reportChange: true });
    } catch (error) {
      this.host.addSystemMessage(errorMessage(error));
      return false;
    }
  }

  private applyGoalIfActive(threadId: string, goal: ThreadGoal | null, options: { reportChange: boolean }): boolean {
    const state = this.host.stateStore.getState();
    if (state.activeThread.id !== threadId) return false;
    const item = options.reportChange ? goalChangeItem(goalEventId(), state.activeThread.goal, goal) : null;
    this.host.stateStore.dispatch({ type: "active-thread/goal-set", goal });
    if (item) this.host.addGoalEvent(item);
    this.host.refreshLiveState();
    this.host.render();
    return true;
  }

  private async recordGoalUserMessage(threadId: string, objective: string): Promise<void> {
    const client = this.host.currentClient();
    if (!client) return;
    try {
      await client.injectThreadItems(threadId, [goalUserHistoryItem(objective)]);
    } catch (error) {
      this.host.addSystemMessage(`Could not record goal message: ${errorMessage(error)}`);
    }
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
