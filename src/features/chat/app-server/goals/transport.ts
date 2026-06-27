import { readThreadGoal, recordThreadGoalUserMessage, setThreadGoal } from "../../../../app-server/threads";
import type { ThreadGoalReader, ThreadGoalTransport } from "../../application/threads/goal-transport";
import type { ConnectedChatAppServerClientHost, CurrentChatAppServerClientHost } from "../client-scope";
import { chatAppServerClientIsStale, withConnectedChatAppServerClient, withCurrentChatAppServerClient } from "../client-scope";

export function createChatThreadGoalReadTransport(host: CurrentChatAppServerClientHost): ThreadGoalReader {
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
): ReturnType<ThreadGoalReader["readThreadGoal"]> {
  const client = host.currentClient();
  if (!client) return undefined;
  const goal = await readThreadGoal(client, threadId);
  return chatAppServerClientIsStale(host, client) ? undefined : goal;
}
