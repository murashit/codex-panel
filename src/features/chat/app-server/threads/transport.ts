import { compactThread, forkThread, rollbackThread } from "../../../../app-server/threads";
import type { ThreadMutationTransport, ThreadRollbackSnapshot } from "../../application/threads/thread-mutation-transport";
import type { ConnectedChatAppServerClientHost } from "../client-scope";
import { withConnectedChatAppServerClient } from "../client-scope";
import { messageStreamItemsFromTurns } from "../mappers/message-stream/turn-items";

interface ChatThreadMutationTransportHost extends ConnectedChatAppServerClientHost {
  vaultPath: string;
}

export function createChatThreadMutationTransport(host: ChatThreadMutationTransportHost): ThreadMutationTransport {
  return {
    compactThread: async (threadId) => {
      const result = await withConnectedChatAppServerClient(host, async (client) => {
        await compactThread(client, threadId);
        return true;
      });
      return result ?? false;
    },
    forkThread: (threadId) => withConnectedChatAppServerClient(host, (client) => forkThread(client, threadId, host.vaultPath)),
    rollbackForkedThread: (threadId, turnsToDrop) =>
      withConnectedChatAppServerClient(host, async (client) => (await rollbackThread(client, threadId, turnsToDrop)).thread),
    rollbackThread: (threadId) =>
      withConnectedChatAppServerClient(host, async (client): Promise<ThreadRollbackSnapshot> => {
        const snapshot = await rollbackThread(client, threadId);
        return {
          thread: snapshot.thread,
          cwd: snapshot.cwd,
          items: messageStreamItemsFromTurns(snapshot.turns),
        };
      }),
  };
}
