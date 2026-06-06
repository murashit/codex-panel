import type { AppServerClient } from "../../app-server/client";
import type { ThreadGoal } from "../../generated/app-server/v2/ThreadGoal";
import type { ThreadGoalStatus } from "../../generated/app-server/v2/ThreadGoalStatus";
import type { ChatStateStore } from "./chat-state";
import { goalChangeMessage } from "./goal-messages";

export interface ChatGoalControllerHost {
  stateStore: ChatStateStore;
  currentClient: () => AppServerClient | null;
  ensureConnected: () => Promise<void>;
  addSystemMessage: (text: string) => void;
  render: () => void;
  refreshLiveState: () => void;
}

export class ChatGoalController {
  constructor(private readonly host: ChatGoalControllerHost) {}

  activeGoal(): ThreadGoal | null {
    return this.host.stateStore.getState().activeGoal;
  }

  async syncThreadGoal(threadId: string): Promise<void> {
    const client = this.host.currentClient();
    if (!client) return;
    try {
      const response = await client.getThreadGoal(threadId);
      this.applyGoalIfActive(threadId, response.goal, { reportChange: false });
    } catch (error) {
      if (this.host.stateStore.getState().activeThreadId !== threadId) return;
      this.host.addSystemMessage(`Could not load thread goal: ${errorMessage(error)}`);
    }
  }

  async setObjective(threadId: string, objective: string, tokenBudget: number | null): Promise<boolean> {
    const trimmed = objective.trim();
    if (!trimmed) {
      this.host.addSystemMessage("Goal objective cannot be empty.");
      return false;
    }
    const current = this.host.stateStore.getState().activeGoal;
    const applied = await this.setGoal(threadId, {
      objective: trimmed,
      status: current?.status ?? "active",
      tokenBudget,
    });
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
      this.applyGoalIfActive(threadId, response.goal, { reportChange: true });
      return true;
    } catch (error) {
      this.host.addSystemMessage(errorMessage(error));
      return false;
    }
  }

  private applyGoalIfActive(threadId: string, goal: ThreadGoal | null, options: { reportChange: boolean }): void {
    const state = this.host.stateStore.getState();
    if (state.activeThreadId !== threadId) return;
    const message = options.reportChange ? goalChangeMessage(state.activeGoal, goal) : null;
    this.host.stateStore.dispatch({ type: "thread/goal-set", goal });
    if (message) this.host.addSystemMessage(message);
    this.host.refreshLiveState();
    this.host.render();
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
