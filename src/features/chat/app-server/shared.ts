import type { AppServerClient } from "../../../app-server/client";
import type { AppServerDiagnostics } from "../../../app-server/compatibility";
import type { ChatAction, ChatState, ChatStateStore } from "../chat-state";

export interface ChatAppServerBaseHost {
  stateStore: ChatStateStore;
  vaultPath: string;
  currentClient: () => AppServerClient | null;
}

export function chatAppServerState(host: ChatAppServerBaseHost): ChatState {
  return host.stateStore.getState();
}

export function dispatchChatAppServerAction(host: ChatAppServerBaseHost, action: ChatAction): void {
  host.stateStore.dispatch(action);
}

export function cloneAppServerDiagnostics(diagnostics: AppServerDiagnostics): AppServerDiagnostics {
  return {
    probes: { ...diagnostics.probes },
    mcpServers: diagnostics.mcpServers.map((server) => ({ ...server })),
  };
}
