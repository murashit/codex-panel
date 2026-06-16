import type { AppServerClient } from "../../../../app-server/connection/client";
import type { ChatStateStore } from "../../application/state/store";

export interface ChatServerActionHost {
  stateStore: ChatStateStore;
  vaultPath: string;
  currentClient: () => AppServerClient | null;
}
