import type { AppServerClient } from "../../../../app-server/connection/client";
import type { ChatStateStore } from "../../application/state/store";

export interface ChatServerActionsHost {
  stateStore: ChatStateStore;
  vaultPath: string;
  currentClient: () => AppServerClient | null;
}

export interface ChatServerClientScope {
  client: AppServerClient | null;
  isStale: () => boolean;
}

export function captureChatServerClientScope(host: ChatServerActionsHost): ChatServerClientScope {
  const client = host.currentClient();
  return {
    client,
    isStale: () => client !== null && host.currentClient() !== client,
  };
}
