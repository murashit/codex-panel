import type { AppServerClient } from "../../../app-server/connection/client";
import type { AppServerClientAccess, AppServerClientAccessOptions } from "../../../app-server/connection/client-access";
import { withShortLivedAppServerClient } from "../../../app-server/connection/short-lived-client";
import type { CodexInput } from "../../../domain/chat/input";
import type { ComposerInputSnapshot } from "../application/composer/input-snapshot";
import { createThreadReferenceResolver, type ThreadReferenceResolver } from "./thread-reference-resolver";
import { type ChatMetadataTransports, createChatMetadataTransports } from "./transports/metadata-transports";
import { type ChatSessionTransports, createChatSessionTransports } from "./transports/session-transports";

export interface ChatAppServerGatewayHost {
  codexPath(): string;
  vaultPath: string;
  currentClient(): AppServerClient | null;
  connectedClient(): Promise<AppServerClient | null>;
}

interface ChatThreadReferenceResolverOptions {
  prepareInput(text: string, snapshot: ComposerInputSnapshot): { text: string; input: CodexInput };
  addSystemMessage(text: string): void;
  setStatus(status: string): void;
}

export interface ChatAppServerGateway extends ChatSessionTransports, ChatMetadataTransports {
  clientAccess: AppServerClientAccess;
  connectionAvailable(): boolean;
  readFileBase64(path: string, options?: { timeoutMs?: number }): Promise<string | null>;
  threadReferences(options: ChatThreadReferenceResolverOptions): ThreadReferenceResolver;
}

export function createChatAppServerGateway(host: ChatAppServerGatewayHost): ChatAppServerGateway {
  return {
    clientAccess: createCurrentClientAccess(host),
    ...createChatSessionTransports(host),
    ...createChatMetadataTransports(host),
    connectionAvailable: () => host.currentClient() !== null,
    readFileBase64: (path, options) => readCurrentClientFileBase64(host, path, options),
    threadReferences: (options) =>
      createThreadReferenceResolver({
        currentClient: () => host.currentClient(),
        prepareInput: (text, snapshot) => options.prepareInput(text, snapshot),
        addSystemMessage: (text) => {
          options.addSystemMessage(text);
        },
        setStatus: (status) => {
          options.setStatus(status);
        },
      }),
  };
}

function createCurrentClientAccess(host: ChatAppServerGatewayHost): AppServerClientAccess {
  return {
    withClient: async (operation, options: AppServerClientAccessOptions = {}) => {
      if (options.serverRequests?.kind === "reject") {
        return withShortLivedAppServerClient(host.codexPath(), host.vaultPath, operation, options);
      }

      const client = host.currentClient();
      if (!client) throw new Error("Codex app-server is not connected.");
      const result = await operation(client);
      if (host.currentClient() !== client) {
        throw new Error("Codex app-server connection changed while running the operation.");
      }
      return result;
    },
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
  return host.currentClient() === client ? response.dataBase64 : null;
}
