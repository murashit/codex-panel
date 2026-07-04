import type { AppServerClient } from "../../../app-server/connection/client";
import type { AppServerClientAccess } from "../../../app-server/connection/client-access";
import type { CodexInput } from "../../../domain/chat/input";
import type { ChatTurnTransport } from "../application/conversation/turn-transport";
import type { RuntimeSettingsTransport } from "../application/runtime/settings-transport";
import type { ThreadGoalReadTransport, ThreadGoalTransport } from "../application/threads/goal-transport";
import type { ThreadHistoryTransport, ThreadResumeTransport } from "../application/threads/thread-loading-transport";
import type { ThreadMutationTransport } from "../application/threads/thread-mutation-transport";
import { createThreadReferenceResolver, type ThreadReferenceResolver } from "./thread-reference-resolver";
import {
  createChatRuntimeSettingsTransport,
  createChatThreadGoalReadTransport,
  createChatThreadGoalTransport,
  createChatThreadHistoryTransport,
  createChatThreadMutationTransport,
  createChatThreadResumeTransport,
  createChatTurnTransport,
} from "./transports/session-transports";

export interface ChatAppServerGatewayHost {
  vaultPath: string;
  currentClient(): AppServerClient | null;
  connectedClient(): Promise<AppServerClient | null>;
}

interface ChatThreadReferenceResolverOptions {
  prepareInput(text: string): { text: string; input: CodexInput };
  addSystemMessage(text: string): void;
  setStatus(status: string): void;
}

export interface ChatAppServerGateway {
  clientAccess: AppServerClientAccess;
  turn: ChatTurnTransport;
  runtimeSettings: RuntimeSettingsTransport;
  threadHistory: ThreadHistoryTransport;
  threadResume: ThreadResumeTransport;
  threadMutation: ThreadMutationTransport;
  threadGoalRead: ThreadGoalReadTransport;
  threadGoal: ThreadGoalTransport;
  connectionAvailable(): boolean;
  readFileBase64(path: string, options?: { timeoutMs?: number }): Promise<string>;
  threadReferences(options: ChatThreadReferenceResolverOptions): ThreadReferenceResolver;
}

export function createChatAppServerGateway(host: ChatAppServerGatewayHost): ChatAppServerGateway {
  return {
    clientAccess: createCurrentClientAccess(() => host.currentClient()),
    turn: createChatTurnTransport(host),
    runtimeSettings: createChatRuntimeSettingsTransport(host),
    threadHistory: createChatThreadHistoryTransport(host),
    threadResume: createChatThreadResumeTransport(host),
    threadMutation: createChatThreadMutationTransport(host),
    threadGoalRead: createChatThreadGoalReadTransport(host),
    threadGoal: createChatThreadGoalTransport(host),
    connectionAvailable: () => host.currentClient() !== null,
    readFileBase64: (path, options) => readCurrentClientFileBase64(host, path, options),
    threadReferences: (options) =>
      createThreadReferenceResolver({
        currentClient: () => host.currentClient(),
        prepareInput: (text) => options.prepareInput(text),
        addSystemMessage: (text) => {
          options.addSystemMessage(text);
        },
        setStatus: (status) => {
          options.setStatus(status);
        },
      }),
  };
}

function createCurrentClientAccess(currentClient: () => AppServerClient | null): AppServerClientAccess {
  return {
    withClient: async (operation) => {
      const client = currentClient();
      if (!client) throw new Error("Codex app-server is not connected.");
      const result = await operation(client);
      if (currentClient() !== client) {
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
): Promise<string> {
  const client = host.currentClient();
  if (!client) return "";
  const response = await client.request("fs/readFile", { path }, options);
  return host.currentClient() === client ? response.dataBase64 : "";
}
