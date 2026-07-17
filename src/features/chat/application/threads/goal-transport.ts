import type { ThreadGoal, ThreadGoalUpdate } from "../../../../domain/threads/goal";
import type { EffectOutcome } from "../effect-outcome";

export interface ThreadGoalReadTransport {
  readThreadGoal(threadId: string): Promise<ThreadGoal | null | undefined>;
}

export interface ThreadGoalTransport extends ThreadGoalReadTransport {
  setThreadGoal(threadId: string, params: ThreadGoalUpdate): Promise<EffectOutcome<ThreadGoal | null>>;
  clearThreadGoal(threadId: string): Promise<EffectOutcome<void>>;
  recordThreadGoalUserMessage(threadId: string, objective: string): Promise<boolean>;
  ensureConnected(): Promise<boolean>;
}
