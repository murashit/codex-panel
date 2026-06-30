import { interruptTurn, startTurn, steerTurn } from "../../../../app-server/services/turns";
import type { ChatTurnTransport } from "../../application/conversation/turn-transport";
import type { ConnectedChatAppServerClientHost } from "./client-scope";
import { withCurrentChatAppServerClient } from "./client-scope";

interface ChatTurnTransportHost extends ConnectedChatAppServerClientHost {
  vaultPath: string;
}

export function createChatTurnTransport(host: ChatTurnTransportHost): ChatTurnTransport {
  return {
    ensureConnected: async () => (await host.connectedClient()) !== null,
    startTurn: (request) =>
      withCurrentChatAppServerClient(host, async (client) => {
        const response = await startTurn(client, {
          threadId: request.threadId,
          cwd: host.vaultPath,
          input: request.input,
          clientUserMessageId: request.clientUserMessageId,
        });
        return { turnId: response.turn.id };
      }),
    steerTurn: async (request) => {
      const steered = await withCurrentChatAppServerClient(host, async (client) => {
        await steerTurn(client, request.threadId, request.turnId, request.input, request.clientUserMessageId);
        return true;
      });
      return steered ?? false;
    },
    interruptTurn: async (threadId, turnId) => {
      const interrupted = await withCurrentChatAppServerClient(host, async (client) => {
        await interruptTurn(client, threadId, turnId);
        return true;
      });
      return interrupted ?? false;
    },
  };
}
