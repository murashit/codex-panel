import type { AppServerClient } from "../../../../app-server/connection/client";
import type { ChatStateStore } from "../../application/state/store";

export interface ChatServerActionHost {
  stateStore: ChatStateStore;
  vaultPath: string;
  currentClient: () => AppServerClient | null;
}

export interface ChatServerActionClientScope {
  client: AppServerClient | null;
  isStale: () => boolean;
}

export function captureChatServerActionClientScope(host: ChatServerActionHost): ChatServerActionClientScope {
  const client = host.currentClient();
  return {
    client,
    isStale: () => client !== null && host.currentClient() !== client,
  };
}
