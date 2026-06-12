import type { AppServerClient } from "../../../../app-server/connection/client";
import type { Diagnostics } from "../../../../app-server/protocol/diagnostics";
import type { ChatStateStore } from "../../state/reducer";

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
