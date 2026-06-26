import type { AppServerClient } from "../../../../app-server/connection/client";
import { threadActivationSnapshotFromAppServerResponse } from "../../../../app-server/threads";
import type { ThreadActivationSnapshot } from "../../../../domain/threads/activation";
import type { ThreadTurnsPage } from "../../../../domain/threads/history";
import type { MessageStreamItem } from "../../domain/message-stream/items";
import { messageStreamItemsFromTurns } from "../mappers/message-stream/turn-items";

export type ChatThreadHistoryClient = Pick<AppServerClient, "threadTurnsList">;
export type ChatThreadResumeClient = Pick<AppServerClient, "resumeThread">;

interface AppServerThreadTurnsPage {
  readonly data: ThreadTurnsPage["turns"];
  readonly nextCursor: string | null;
}

export interface ChatThreadHistoryPage {
  items: MessageStreamItem[];
  nextCursor: string | null;
  hadTurns: boolean;
}

export interface ChatThreadResumeSnapshot {
  activation: ThreadActivationSnapshot;
  rolloutPath: string | null;
  initialHistoryPage: ChatThreadHistoryPage | null;
}

export async function readChatThreadHistoryPage(
  client: ChatThreadHistoryClient,
  threadId: string,
  cursor: string | null,
  limit = 20,
): Promise<ChatThreadHistoryPage> {
  return chatThreadHistoryPageFromTurnsPage(threadTurnsPageFromAppServerPage(await client.threadTurnsList(threadId, cursor, limit)));
}

function chatThreadHistoryPageFromTurnsPage(page: ThreadTurnsPage): ChatThreadHistoryPage {
  return {
    items: messageStreamItemsFromTurns(page.turns),
    nextCursor: page.nextCursor,
    hadTurns: page.turns.length > 0,
  };
}

export async function resumeChatThread(client: ChatThreadResumeClient, threadId: string, cwd: string): Promise<ChatThreadResumeSnapshot> {
  const response = await client.resumeThread(threadId, cwd);
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
