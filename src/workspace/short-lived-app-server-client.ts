import type { AppServerClient } from "../app-server/client";
import { withShortLivedAppServerClient } from "../app-server/short-lived-client";

export interface ShortLivedFallbackAppServerClientOptions {
  codexPath: string;
  cwd: string;
  currentClient?: () => AppServerClient | null;
  unhandledServerRequestMessage: string;
}

export async function withShortLivedFallbackAppServerClient<T>(
  options: ShortLivedFallbackAppServerClientOptions,
  operation: (client: AppServerClient) => Promise<T>,
): Promise<T> {
  const currentClient = options.currentClient?.();
  if (currentClient?.isConnected()) return operation(currentClient);

  return withShortLivedAppServerClient(options.codexPath, options.cwd, operation, {
    unhandledServerRequestMessage: options.unhandledServerRequestMessage,
  });
}
