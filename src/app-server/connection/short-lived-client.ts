import { AppServerClient } from "./client";

interface ShortLivedAppServerClientOptions {
  unhandledServerRequestMessage?: string;
}

export async function withShortLivedAppServerClient<T>(
  codexPath: string,
  cwd: string,
  operation: (client: AppServerClient) => Promise<T>,
  options: ShortLivedAppServerClientOptions = {},
): Promise<T> {
  let client!: AppServerClient;
  client = new AppServerClient(codexPath, cwd, {
    onNotification: () => undefined,
    onServerRequest: (request) => {
      client.rejectServerRequest(
        request.id,
        -32601,
        options.unhandledServerRequestMessage ?? "This Codex Panel view does not handle server requests.",
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
