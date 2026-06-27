import { readThreadGoal, recordThreadGoalUserMessage, setThreadGoal } from "../../../../app-server/threads";
import type { ThreadGoalTransport } from "../../application/threads/goal-transport";
import type { ConnectedChatAppServerClientHost } from "../client-scope";
import { chatAppServerClientIsStale, withConnectedChatAppServerClient, withCurrentChatAppServerClient } from "../client-scope";

export function createChatThreadGoalTransport(host: ConnectedChatAppServerClientHost): ThreadGoalTransport {
  return {
    ensureConnected: async () => (await host.connectedClient()) !== null,
    readThreadGoal: async (threadId) => {
      const client = host.currentClient();
      if (!client) return undefined;
      const goal = await readThreadGoal(client, threadId);
      return chatAppServerClientIsStale(host, client) ? undefined : goal;
    },
    setThreadGoal: async (threadId, params) => {
      const client = await host.connectedClient();
      if (!client) return undefined;
      const goal = await setThreadGoal(client, threadId, params);
      return chatAppServerClientIsStale(host, client) ? undefined : goal;
    },
    clearThreadGoal: async (threadId) => {
      const result = await withConnectedChatAppServerClient(host, async (client) => {
        await client.clearThreadGoal(threadId);
        return true;
      });
      return result ?? false;
    },
    recordThreadGoalUserMessage: async (threadId, objective) => {
      const result = await withCurrentChatAppServerClient(host, async (client) => {
        await recordThreadGoalUserMessage(client, threadId, objective);
        return true;
      });
      return result ?? false;
    },
  };
}
