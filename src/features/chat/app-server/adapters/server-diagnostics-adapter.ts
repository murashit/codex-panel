import type { AppServerClient } from "../../../../app-server/connection/client";
import { readToolInventory } from "../../../../app-server/services/tool-inventory";
import type { ServerDiagnosticsPort, ServerDiagnosticsSnapshot } from "../../application/connection/server-diagnostics-port";

interface CurrentChatAppServerClientHost {
  currentClient(): AppServerClient | null;
}

interface ChatServerDiagnosticsAdapterHost extends CurrentChatAppServerClientHost {
  vaultPath: string;
}

export function createChatServerDiagnosticsAdapter(host: ChatServerDiagnosticsAdapterHost): ServerDiagnosticsPort {
  return {
    readServerDiagnostics: async (request): Promise<ServerDiagnosticsSnapshot | null> => {
      const client = host.currentClient();
      if (!client) return null;
      const toolInventory = readToolInventory(client, host.vaultPath, {
        threadId: request.threadId,
        mcpDiagnostics: request.initialDiagnostics.mcpServers,
      });
      const toolInventoryResult = await toolInventory;
      return {
        toolInventory: toolInventoryResult,
      };
    },
  };
}
