import { readThreadGoal, recordThreadGoalUserMessage, setThreadGoal } from "../../../../app-server/services/threads";
import type { ThreadGoalReadTransport, ThreadGoalTransport } from "../../application/threads/goal-transport";
import type { ConnectedChatAppServerClientHost, CurrentChatAppServerClientHost } from "../connection/client-scope";
import { chatAppServerClientIsStale, withConnectedChatAppServerClient, withCurrentChatAppServerClient } from "../connection/client-scope";

export function createChatThreadGoalReadTransport(host: CurrentChatAppServerClientHost): ThreadGoalReadTransport {
  return {
    readThreadGoal: (threadId) => readThreadGoalFromCurrentClient(host, threadId),
  };
}

export function createChatThreadGoalTransport(host: ConnectedChatAppServerClientHost): ThreadGoalTransport {
  return {
    ensureConnected: async () => (await host.connectedClient()) !== null,
    readThreadGoal: (threadId) => readThreadGoalFromCurrentClient(host, threadId),
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

async function readThreadGoalFromCurrentClient(
  host: CurrentChatAppServerClientHost,
  threadId: string,
): ReturnType<ThreadGoalReadTransport["readThreadGoal"]> {
  const client = host.currentClient();
  if (!client) return undefined;
  const goal = await readThreadGoal(client, threadId);
  return chatAppServerClientIsStale(host, client) ? undefined : goal;
}
