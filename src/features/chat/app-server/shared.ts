import type { AppServerClient } from "../../../app-server/client";
import type { AppServerDiagnostics } from "../../../app-server/compatibility";
import type { ChatStateStore } from "../chat-state";

export interface ChatAppServerBaseHost {
  stateStore: ChatStateStore;
  vaultPath: string;
  currentClient: () => AppServerClient | null;
}

export function cloneAppServerDiagnostics(diagnostics: AppServerDiagnostics): AppServerDiagnostics {
  return {
    probes: { ...diagnostics.probes },
    mcpServers: diagnostics.mcpServers.map((server) => ({ ...server })),
  };
}
