import type { AppServerClient } from "../../../app-server/connection/client";
import type { AppServerClientAccess, AppServerClientAccessOptions } from "../../../app-server/connection/client-access";
import { withShortLivedAppServerClient } from "../../../app-server/connection/short-lived-client";
import type { CodexInput } from "../../../domain/chat/input";
import type { ComposerInputSnapshot } from "../application/composer/input-snapshot";
import { createThreadReferenceResolver, type ThreadReferenceResolver } from "./thread-reference-resolver";
import { type ChatMetadataTransports, createChatMetadataTransports } from "./transports/metadata-transports";
import {
  type ChatConnectedSessionTransports,
  type ChatCurrentSessionTransports,
  createChatConnectedSessionTransports,
  createChatCurrentSessionTransports,
} from "./transports/session-transports";

export interface ChatCurrentAppServerGatewayHost {
  codexPath(): string;
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

export interface ChatCurrentAppServerGateway extends ChatCurrentSessionTransports, ChatMetadataTransports {
  clientAccess: AppServerClientAccess;
  connectionAvailable(): boolean;
  readFileBase64(path: string, options?: { timeoutMs?: number }): Promise<string | null>;
  threadReferences(options: ChatThreadReferenceResolverOptions): ThreadReferenceResolver;
}

export interface ChatAppServerGateway extends ChatCurrentAppServerGateway, ChatConnectedSessionTransports {}

export function createChatCurrentAppServerGateway(host: ChatCurrentAppServerGatewayHost): ChatCurrentAppServerGateway {
  return {
    clientAccess: createCurrentClientAccess(host),
    ...createChatCurrentSessionTransports(host),
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

export function createChatAppServerGateway(
  currentGateway: ChatCurrentAppServerGateway,
  host: ChatConnectedAppServerGatewayHost,
): ChatAppServerGateway {
  return {
    ...currentGateway,
    ...createChatConnectedSessionTransports(host),
  };
}

function createCurrentClientAccess(host: ChatCurrentAppServerGatewayHost): AppServerClientAccess {
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
  host: ChatCurrentAppServerGatewayHost,
  path: string,
  options: { timeoutMs?: number } = {},
): Promise<string | null> {
  const client = host.currentClient();
  if (!client) return null;
  const response = await client.request("fs/readFile", { path }, options);
  return host.currentClient() === client ? response.dataBase64 : null;
}
