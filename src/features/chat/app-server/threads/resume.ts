import type { AppServerClient } from "../../../../app-server/connection/client";
import { threadActivationSnapshotFromAppServerResponse } from "../../../../app-server/threads";
import type { ThreadActivationSnapshot } from "../../../../domain/threads/activation";
import type { ChatThreadHistoryPage } from "./history";
import { chatThreadHistoryPageFromTurnsPage } from "./history";

export interface ChatThreadResumeSnapshot {
  activation: ThreadActivationSnapshot;
  rolloutPath: string | null;
  initialHistoryPage: ChatThreadHistoryPage | null;
}

export async function resumeChatThread(client: AppServerClient, threadId: string, cwd: string): Promise<ChatThreadResumeSnapshot> {
  const response = await client.resumeThread(threadId, cwd);
  return {
    activation: threadActivationSnapshotFromAppServerResponse(response),
    rolloutPath: response.thread.path,
    initialHistoryPage: response.initialTurnsPage ? chatThreadHistoryPageFromTurnsPage(response.initialTurnsPage) : null,
  };
}
