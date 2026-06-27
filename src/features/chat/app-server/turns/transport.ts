import type { ChatTurnTransport } from "../../application/conversation/turn-transport";
import type { ConnectedChatAppServerClientHost } from "../connection/client-scope";
import { withCurrentChatAppServerClient } from "../connection/client-scope";

interface ChatTurnTransportHost extends ConnectedChatAppServerClientHost {
  vaultPath: string;
}

export function createChatTurnTransport(host: ChatTurnTransportHost): ChatTurnTransport {
  return {
    ensureConnected: async () => (await host.connectedClient()) !== null,
    startTurn: (request) =>
      withCurrentChatAppServerClient(host, async (client) => {
        const response = await client.startTurn({
          threadId: request.threadId,
          cwd: host.vaultPath,
          input: request.input,
          clientUserMessageId: request.clientUserMessageId,
        });
        return { turnId: response.turn.id };
      }),
    steerTurn: async (request) => {
      const steered = await withCurrentChatAppServerClient(host, async (client) => {
        await client.steerTurn(request.threadId, request.turnId, request.input, request.clientUserMessageId);
        return true;
      });
      return steered ?? false;
    },
    interruptTurn: async (threadId, turnId) => {
      const interrupted = await withCurrentChatAppServerClient(host, async (client) => {
        await client.interruptTurn(threadId, turnId);
        return true;
      });
      return interrupted ?? false;
    },
  };
}
