import type { AppServerClient } from "../../../app-server/connection/client";
import type { ComposerInputSnapshot } from "../application/composer/input-snapshot";
import type { PreparedInput } from "../application/composer/prepared-input";
import type { ServerDiagnosticsPort } from "../application/connection/server-diagnostics-port";
import { createChatServerDiagnosticsAdapter } from "./adapters/server-diagnostics-adapter";
import { type ChatSessionAdapters, createChatSessionAdapters } from "./adapters/session-adapters";
import { createThreadReferenceResolver, type ThreadReferenceResolver } from "./adapters/thread-reference-resolver";

export interface ChatAppServerGatewayHost {
  vaultPath: string;
  currentClient(): AppServerClient | null;
}

interface ChatThreadReferenceResolverOptions {
  prepareInput(text: string, snapshot: ComposerInputSnapshot): PreparedInput;
  addSystemMessage(text: string): void;
  setStatus(status: string): void;
}

export interface ChatAppServerGateway extends ChatSessionAdapters {
  serverDiagnostics: ServerDiagnosticsPort;
  connectionAvailable(): boolean;
  readFileBase64(path: string, options?: { timeoutMs?: number }): Promise<string | null>;
  threadReferences(options: ChatThreadReferenceResolverOptions): ThreadReferenceResolver;
}

export function createChatAppServerGateway(host: ChatAppServerGatewayHost): ChatAppServerGateway {
  return {
    ...createChatSessionAdapters(host),
    serverDiagnostics: createChatServerDiagnosticsAdapter(host),
    connectionAvailable: () => host.currentClient() !== null,
    readFileBase64: (path, options) => readCurrentClientFileBase64(host, path, options),
    threadReferences: (options) =>
      createThreadReferenceResolver({
        currentClient: () => host.currentClient(),
        ...options,
      }),
  };
}

async function readCurrentClientFileBase64(
  host: ChatAppServerGatewayHost,
  path: string,
  options: { timeoutMs?: number } = {},
): Promise<string | null> {
  const client = host.currentClient();
  if (!client) return null;
  const response = await client.request("fs/readFile", { path }, options);
  return response.dataBase64;
}
