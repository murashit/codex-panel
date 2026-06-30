import type { AppServerRequestClient } from "../../../../app-server/services/request-client";
import { listThreadTurns, resumeThread, threadActivationSnapshotFromAppServerResponse } from "../../../../app-server/services/threads";
import type { ThreadTurnsPage } from "../../../../domain/threads/history";
import type {
  ThreadHistoryPage,
  ThreadHistoryTransport,
  ThreadResumeSnapshot,
  ThreadResumeTransport,
} from "../../application/threads/thread-loading-transport";
import { messageStreamItemsFromTurns } from "../mappers/message-stream/turn-items";
import type { ConnectedChatAppServerClientHost, CurrentChatAppServerClientHost } from "./client-scope";
import { withConnectedChatAppServerClient, withCurrentChatAppServerClient } from "./client-scope";

type ChatThreadHistoryClient = AppServerRequestClient;
type ChatThreadResumeClient = AppServerRequestClient;

interface AppServerThreadTurnsPage {
  readonly data: ThreadTurnsPage["turns"];
  readonly nextCursor: string | null;
}

interface ChatThreadResumeTransportHost extends ConnectedChatAppServerClientHost {
  vaultPath: string;
}

export function createChatThreadHistoryTransport(host: CurrentChatAppServerClientHost): ThreadHistoryTransport {
  return {
    readHistoryPage: (threadId, cursor, limit): Promise<ThreadHistoryPage | null> =>
      withCurrentChatAppServerClient(host, (client) => readChatThreadHistoryPage(client, threadId, cursor, limit)),
  };
}

export function createChatThreadResumeTransport(host: ChatThreadResumeTransportHost): ThreadResumeTransport {
  return {
    resumeThread: (threadId): Promise<ThreadResumeSnapshot | null> =>
      withConnectedChatAppServerClient(host, (client) => resumeChatThread(client, threadId, host.vaultPath)),
  };
}

async function readChatThreadHistoryPage(
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

async function resumeChatThread(client: ChatThreadResumeClient, threadId: string, cwd: string): Promise<ThreadResumeSnapshot> {
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
