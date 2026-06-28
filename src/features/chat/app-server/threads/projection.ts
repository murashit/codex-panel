import type { AppServerRequestClient } from "../../../../app-server/services/request-client";
import { listThreadTurns, resumeThread, threadActivationSnapshotFromAppServerResponse } from "../../../../app-server/services/threads";
import type { ThreadTurnsPage } from "../../../../domain/threads/history";
import type { ThreadHistoryPage, ThreadResumeSnapshot } from "../../application/threads/thread-loading-transport";
import { messageStreamItemsFromTurns } from "../mappers/message-stream/turn-items";

type ChatThreadHistoryClient = AppServerRequestClient;
type ChatThreadResumeClient = AppServerRequestClient;

interface AppServerThreadTurnsPage {
  readonly data: ThreadTurnsPage["turns"];
  readonly nextCursor: string | null;
}

export async function readChatThreadHistoryPage(
  client: ChatThreadHistoryClient,
  threadId: string,
  cursor: string | null,
  limit = 20,
): Promise<ThreadHistoryPage> {
  return chatThreadHistoryPageFromTurnsPage(threadTurnsPageFromAppServerPage(await listThreadTurns(client, threadId, cursor, limit)));
}

function chatThreadHistoryPageFromTurnsPage(page: ThreadTurnsPage): ThreadHistoryPage {
  return {
    items: messageStreamItemsFromTurns(page.turns),
    nextCursor: page.nextCursor,
    hadTurns: page.turns.length > 0,
  };
}

export async function resumeChatThread(client: ChatThreadResumeClient, threadId: string, cwd: string): Promise<ThreadResumeSnapshot> {
  const response = await resumeThread(client, threadId, cwd);
  return {
    activation: threadActivationSnapshotFromAppServerResponse(response),
    rolloutPath: response.thread.path,
    initialHistoryPage: response.initialTurnsPage
      ? chatThreadHistoryPageFromTurnsPage(threadTurnsPageFromAppServerPage(response.initialTurnsPage))
      : null,
  };
}

function threadTurnsPageFromAppServerPage(page: AppServerThreadTurnsPage): ThreadTurnsPage {
  return {
    turns: page.data,
    nextCursor: page.nextCursor,
  };
}
