import type { AppServerClient } from "../../../app-server/client";
import type { Diagnostics } from "../../../app-server/diagnostics";
import type { ChatStateStore } from "../chat-state";

export interface ChatServerActionHost {
  stateStore: ChatStateStore;
  vaultPath: string;
  currentClient: () => AppServerClient | null;
}

export function cloneAppServerDiagnostics(diagnostics: Diagnostics): Diagnostics {
  return {
    probes: { ...diagnostics.probes },
    mcpServers: diagnostics.mcpServers.map((server) => ({ ...server })),
  };
}
