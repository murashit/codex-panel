import type { AppServerClient } from "../app-server/client";
import { withShortLivedAppServerClient } from "../app-server/short-lived-client";

export interface ShortLivedFallbackAppServerClientOptions {
  codexPath: string;
  cwd: string;
  unhandledServerRequestMessage: string;
}

export async function withShortLivedFallbackAppServerClient<T>(
  options: ShortLivedFallbackAppServerClientOptions,
  operation: (client: AppServerClient) => Promise<T>,
): Promise<T> {
  return withShortLivedAppServerClient(options.codexPath, options.cwd, operation, {
    unhandledServerRequestMessage: options.unhandledServerRequestMessage,
  });
}
