import { AppServerClient } from "./client";
import type { AppServerClientAccessOptions } from "./client-access";
import { codexPanelAppServerInitializeParams } from "./client-profile";

export async function withShortLivedAppServerClient<T>(
  codexPath: string,
  cwd: string,
  operation: (client: AppServerClient) => Promise<T>,
  options: AppServerClientAccessOptions = {},
): Promise<T> {
  const client = new AppServerClient({
    codexPath,
    cwd,
    initializeParams: codexPanelAppServerInitializeParams(),
    handlers: {
      onNotification: () => undefined,
      onServerRequest: (request, responder) => {
        void request;
        responder.reject(
          -32601,
          options.serverRequests?.kind === "reject"
            ? options.serverRequests.message
            : "This Codex Panel view does not handle server requests.",
        );
      },
      onLog: () => undefined,
      onExit: () => undefined,
    },
  });

  try {
    await client.connect();
    return await operation(client);
  } finally {
    client.disconnect();
  }
}
