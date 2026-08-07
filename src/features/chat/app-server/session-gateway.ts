import type { AppServerClient } from "../../../app-server/connection/client";
import type { CodexInput } from "../../../domain/turns/input";
import type { ComposerInputSnapshot } from "../application/composer/input-snapshot";
import type { ServerDiagnosticsPort } from "../application/connection/server-diagnostics-port";
import { createChatServerDiagnosticsAdapter } from "./adapters/server-diagnostics-adapter";
import {
  type ChatConnectedSessionAdapters,
  type ChatCurrentSessionAdapters,
  createChatConnectedSessionAdapters,
  createChatCurrentSessionAdapters,
} from "./adapters/session-adapters";
import { createThreadReferenceResolver, type ThreadReferenceResolver } from "./thread-reference-resolver";

export interface ChatCurrentAppServerGatewayHost {
  vaultPath: string;
  currentClient(): AppServerClient | null;
}

export interface ChatConnectedAppServerGatewayHost {
  vaultPath: string;
  currentClient(): AppServerClient | null;
  connectedClient(): Promise<AppServerClient | null>;
}

interface ChatThreadReferenceResolverOptions {
  prepareInput(text: string, snapshot: ComposerInputSnapshot): { text: string; input: CodexInput };
  addSystemMessage(text: string): void;
  setStatus(status: string): void;
}

export interface ChatCurrentAppServerGateway extends ChatCurrentSessionAdapters {
  serverDiagnostics: ServerDiagnosticsPort;
  connectionAvailable(): boolean;
  readFileBase64(path: string, options?: { timeoutMs?: number }): Promise<string | null>;
  threadReferences(options: ChatThreadReferenceResolverOptions): ThreadReferenceResolver;
}

export interface ChatAppServerGateway extends ChatCurrentAppServerGateway, ChatConnectedSessionAdapters {}

export function createChatCurrentAppServerGateway(host: ChatCurrentAppServerGatewayHost): ChatCurrentAppServerGateway {
  return {
    ...createChatCurrentSessionAdapters(host),
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

export function createChatAppServerGateway(
  currentGateway: ChatCurrentAppServerGateway,
  host: ChatConnectedAppServerGatewayHost,
): ChatAppServerGateway {
  return {
    ...currentGateway,
    ...createChatConnectedSessionAdapters(host),
  };
}

async function readCurrentClientFileBase64(
  host: ChatCurrentAppServerGatewayHost,
  path: string,
  options: { timeoutMs?: number } = {},
): Promise<string | null> {
  const client = host.currentClient();
  if (!client) return null;
  const response = await client.request("fs/readFile", { path }, options);
  return response.dataBase64;
}
