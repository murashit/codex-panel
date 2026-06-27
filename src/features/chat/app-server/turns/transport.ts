import type { ChatTurnTransport } from "../../application/conversation/turn-transport";
import type { ConnectedChatAppServerClientHost } from "../client-scope";
import { chatAppServerClientIsStale } from "../client-scope";

interface ChatTurnTransportHost extends ConnectedChatAppServerClientHost {
  vaultPath: string;
}

export function createChatTurnTransport(host: ChatTurnTransportHost): ChatTurnTransport {
  return {
    ensureConnected: async () => (await host.connectedClient()) !== null,
    startTurn: async (request) => {
      const client = host.currentClient();
      if (!client) return null;
      const response = await client.startTurn({
        threadId: request.threadId,
        cwd: host.vaultPath,
        input: request.input,
        clientUserMessageId: request.clientUserMessageId,
      });
      return chatAppServerClientIsStale(host, client) ? null : { turnId: response.turn.id };
    },
    steerTurn: async (request) => {
      const client = host.currentClient();
      if (!client) return false;
      await client.steerTurn(request.threadId, request.turnId, request.input, request.clientUserMessageId);
      return !chatAppServerClientIsStale(host, client);
    },
    interruptTurn: async (threadId, turnId) => {
      const client = host.currentClient();
      if (!client) return false;
      await client.interruptTurn(threadId, turnId);
      return !chatAppServerClientIsStale(host, client);
    },
  };
}
