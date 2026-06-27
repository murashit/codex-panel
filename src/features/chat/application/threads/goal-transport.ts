import type { ThreadGoal, ThreadGoalUpdate } from "../../../../domain/threads/goal";

export interface ThreadGoalTransport {
  readThreadGoal(threadId: string): Promise<ThreadGoal | null | undefined>;
  setThreadGoal(threadId: string, params: ThreadGoalUpdate): Promise<ThreadGoal | null | undefined>;
  clearThreadGoal(threadId: string): Promise<boolean>;
  recordThreadGoalUserMessage(threadId: string, objective: string): Promise<boolean>;
  ensureConnected(): Promise<boolean>;
}
