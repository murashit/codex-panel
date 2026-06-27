import type {
  ThreadHistoryPage,
  ThreadHistoryTransport,
  ThreadResumeSnapshot,
  ThreadResumeTransport,
} from "../../application/threads/thread-loading-transport";
import type { ConnectedChatAppServerClientHost, CurrentChatAppServerClientHost } from "../connection/client-scope";
import { withConnectedChatAppServerClient, withCurrentChatAppServerClient } from "../connection/client-scope";
import { readChatThreadHistoryPage, resumeChatThread } from "./projection";

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
