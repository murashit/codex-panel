import { AppServerClient } from "./client";
import type { AppServerClientAccessOptions } from "./client-access";

export async function withShortLivedAppServerClient<T>(
  codexPath: string,
  cwd: string,
  operation: (client: AppServerClient) => Promise<T>,
  options: AppServerClientAccessOptions = {},
): Promise<T> {
  let client!: AppServerClient;
  client = new AppServerClient(codexPath, cwd, {
    onNotification: () => undefined,
    onServerRequest: (request) => {
      client.rejectServerRequest(
        request.id,
        -32601,
        options.serverRequests?.kind === "reject"
          ? options.serverRequests.message
          : "This Codex Panel view does not handle server requests.",
      );
    },
    onLog: () => undefined,
    onExit: () => undefined,
  });

  try {
    await client.connect();
    return await operation(client);
  } finally {
    client.disconnect();
  }
}
