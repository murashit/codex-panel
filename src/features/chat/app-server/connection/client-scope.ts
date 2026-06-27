import type { AppServerClient } from "../../../../app-server/connection/client";

export interface CurrentChatAppServerClientHost {
  currentClient(): AppServerClient | null;
}

export interface ConnectedChatAppServerClientHost extends CurrentChatAppServerClientHost {
  connectedClient(): Promise<AppServerClient | null>;
}

export function chatAppServerClientIsStale(host: CurrentChatAppServerClientHost, client: AppServerClient): boolean {
  return host.currentClient() !== client;
}

export async function withConnectedChatAppServerClient<T>(
  host: ConnectedChatAppServerClientHost,
  operation: (client: AppServerClient) => Promise<T>,
): Promise<T | null> {
  const client = await host.connectedClient();
  if (!client) return null;
  const result = await operation(client);
  return chatAppServerClientIsStale(host, client) ? null : result;
}

export async function withCurrentChatAppServerClient<T>(
  host: CurrentChatAppServerClientHost,
  operation: (client: AppServerClient) => Promise<T>,
): Promise<T | null> {
  const client = host.currentClient();
  if (!client) return null;
  const result = await operation(client);
  return chatAppServerClientIsStale(host, client) ? null : result;
}
