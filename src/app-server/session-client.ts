import { AppServerClient } from "./client";

export async function withAppServerSession<T>(
  codexPath: string,
  cwd: string,
  operation: (client: AppServerClient) => Promise<T>,
): Promise<T> {
  let client!: AppServerClient;
  client = new AppServerClient(codexPath, cwd, {
    onNotification: () => undefined,
    onServerRequest: (request) => {
      client.rejectServerRequest(request.id, -32601, "This Codex Panel view does not handle server requests.");
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
