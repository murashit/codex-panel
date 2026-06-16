import type { AppServerClient } from "../../../../app-server/connection/client";
import type { ThreadTurnsPage } from "../../../../domain/threads/history";
import type { MessageStreamItem } from "../../domain/message-stream/items";
import { messageStreamItemsFromTurns } from "../mappers/message-stream/turn-items";

export interface ChatThreadHistoryPage {
  items: MessageStreamItem[];
  nextCursor: string | null;
  hadTurns: boolean;
}

export async function readChatThreadHistoryPage(
  client: AppServerClient,
  threadId: string,
  cursor: string | null,
  limit = 20,
): Promise<ChatThreadHistoryPage> {
  return chatThreadHistoryPageFromTurnsPage(await client.threadTurnsList(threadId, cursor, limit));
}

export function chatThreadHistoryPageFromTurnsPage(page: ThreadTurnsPage): ChatThreadHistoryPage {
  return {
    items: messageStreamItemsFromTurns(page.data),
    nextCursor: page.nextCursor,
    hadTurns: page.data.length > 0,
  };
}
