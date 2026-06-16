import type { AppServerClient } from "../connection/client";
import type { ThreadGoal, ThreadGoalUpdate } from "../../domain/threads/goal";
import { appServerThreadGoalUserHistoryItem, threadGoalFromAppServerGoal } from "../protocol/thread-goal";

export async function readThreadGoal(client: AppServerClient, threadId: string): Promise<ThreadGoal | null> {
  const response = await client.getThreadGoal(threadId);
  return threadGoalFromAppServerGoal(response.goal);
}

export async function setThreadGoal(client: AppServerClient, threadId: string, params: ThreadGoalUpdate): Promise<ThreadGoal | null> {
  const response = await client.setThreadGoal(threadId, params);
  return threadGoalFromAppServerGoal(response.goal);
}

export async function recordThreadGoalUserMessage(client: AppServerClient, threadId: string, objective: string): Promise<void> {
  await client.injectThreadItems(threadId, [appServerThreadGoalUserHistoryItem(objective)]);
}
