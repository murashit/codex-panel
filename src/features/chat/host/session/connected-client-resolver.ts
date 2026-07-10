import type { AppServerClient } from "../../../../app-server/connection/client";

export interface ConnectedClientResolver {
  resolve(): Promise<AppServerClient | null>;
  bindEnsureConnected(ensureConnected: () => Promise<void>): void;
}

export function createConnectedClientResolver(currentClient: () => AppServerClient | null): ConnectedClientResolver {
  let ensureConnected: (() => Promise<void>) | null = null;

  return {
    resolve: async () => {
      if (!ensureConnected) throw new Error("Codex app-server connection actions are not initialized.");
      await ensureConnected();
      return currentClient();
    },
    bindEnsureConnected: (nextEnsureConnected) => {
      if (ensureConnected) throw new Error("Codex app-server connection actions are already initialized.");
      ensureConnected = nextEnsureConnected;
    },
  };
}
