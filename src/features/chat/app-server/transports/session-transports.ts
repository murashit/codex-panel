import type { AppServerClient } from "../../../../app-server/connection/client";
import type { AppServerRequestClient } from "../../../../app-server/services/request-client";
import {
  clearThreadGoal,
  compactThread,
  forkThread,
  listThreadTurns,
  readThreadGoal,
  recordThreadGoalUserMessage,
  resumeThread,
  rollbackThread,
  setThreadGoal,
  startThread,
  threadActivationSnapshotFromAppServerResponse,
  updateThreadSettings,
} from "../../../../app-server/services/threads";
import { interruptTurn, startTurn, steerTurn } from "../../../../app-server/services/turns";
import type { RuntimeSettingsPatch } from "../../../../domain/runtime/thread-settings";
import type { ThreadTurnsPage } from "../../../../domain/threads/history";
import type { RuntimeSettingsTransport } from "../../application/runtime/settings-transport";
import type { ThreadGoalReadTransport, ThreadGoalTransport } from "../../application/threads/goal-transport";
import type {
  ThreadHistoryPage,
  ThreadHistoryTransport,
  ThreadResumeSnapshot,
  ThreadResumeTransport,
} from "../../application/threads/thread-loading-transport";
import type { ThreadMutationTransport, ThreadRollbackSnapshot } from "../../application/threads/thread-mutation-transport";
import type { ThreadStartTransport } from "../../application/threads/thread-start-transport";
import type { ChatTurnTransport } from "../../application/turns/turn-transport";
import { threadStreamItemsFromTurns } from "../mappers/thread-stream/turn-items";

interface CurrentChatAppServerClientHost {
  currentClient(): AppServerClient | null;
}

interface ConnectedChatAppServerClientHost extends CurrentChatAppServerClientHost {
  connectedClient(): Promise<AppServerClient | null>;
}

interface ChatAppServerTransportHost extends ConnectedChatAppServerClientHost {
  vaultPath: string;
}

type ChatThreadHistoryClient = AppServerRequestClient;
type ChatThreadResumeClient = AppServerRequestClient;

interface AppServerThreadTurnsPage {
  readonly data: ThreadTurnsPage["turns"];
  readonly nextCursor: string | null;
}

export interface ChatSessionTransports {
  readonly turn: ChatTurnTransport;
  readonly runtimeSettings: RuntimeSettingsTransport;
  readonly threadStart: ThreadStartTransport;
  readonly threadHistory: ThreadHistoryTransport;
  readonly threadResume: ThreadResumeTransport;
  readonly threadMutation: ThreadMutationTransport;
  readonly threadGoalRead: ThreadGoalReadTransport;
  readonly threadGoal: ThreadGoalTransport;
}

export function createChatSessionTransports(host: ChatAppServerTransportHost): ChatSessionTransports {
  return {
    turn: createChatTurnTransport(host),
    runtimeSettings: createChatRuntimeSettingsTransport(host),
    threadStart: createChatThreadStartTransport(host),
    threadHistory: createChatThreadHistoryTransport(host),
    threadResume: createChatThreadResumeTransport(host),
    threadMutation: createChatThreadMutationTransport(host),
    threadGoalRead: createChatThreadGoalReadTransport(host),
    threadGoal: createChatThreadGoalTransport(host),
  };
}

function createChatThreadStartTransport(host: ChatAppServerTransportHost): ThreadStartTransport {
  return {
    startThread: (request) =>
      withCurrentChatAppServerClient(host, async (client) => {
        const response = await startThread(client, {
          cwd: host.vaultPath,
          serviceTier: request.serviceTier,
          permissions: request.permissions,
        });
        return threadActivationSnapshotFromAppServerResponse(response);
      }),
  };
}

function createChatTurnTransport(host: ChatAppServerTransportHost): ChatTurnTransport {
  return {
    ensureConnected: async () => (await host.connectedClient()) !== null,
    startTurn: (request) =>
      withCurrentChatAppServerClient(host, async (client) => {
        const response = await startTurn(client, {
          threadId: request.threadId,
          cwd: host.vaultPath,
          input: request.input,
          clientUserMessageId: request.clientUserMessageId,
        });
        return { turnId: response.turn.id };
      }),
    steerTurn: async (request) => {
      const steered = await withCurrentChatAppServerClient(host, async (client) => {
        await steerTurn(client, request.threadId, request.turnId, request.input, request.clientUserMessageId);
        return true;
      });
      return steered ?? false;
    },
    interruptTurn: async (threadId, turnId) => {
      const interrupted = await withCurrentChatAppServerClient(host, async (client) => {
        await interruptTurn(client, threadId, turnId);
        return true;
      });
      return interrupted ?? false;
    },
  };
}

function createChatRuntimeSettingsTransport(host: CurrentChatAppServerClientHost): RuntimeSettingsTransport {
  return {
    updateThreadSettings: async (threadId: string, update: RuntimeSettingsPatch) => {
      const result = await withCurrentChatAppServerClient(host, async (client) => {
        await updateThreadSettings(client, threadId, update);
        return true;
      });
      return result ?? false;
    },
  };
}

function createChatThreadHistoryTransport(host: CurrentChatAppServerClientHost): ThreadHistoryTransport {
  return {
    readHistoryPage: (threadId, cursor, limit): Promise<ThreadHistoryPage | null> =>
      withCurrentChatAppServerClient(host, (client) => readChatThreadHistoryPage(client, threadId, cursor, limit)),
  };
}

function createChatThreadResumeTransport(host: ChatAppServerTransportHost): ThreadResumeTransport {
  return {
    resumeThread: (threadId): Promise<ThreadResumeSnapshot | null> =>
      withConnectedChatAppServerClient(host, (client) => resumeChatThread(client, threadId, host.vaultPath)),
  };
}

function createChatThreadMutationTransport(host: ChatAppServerTransportHost): ThreadMutationTransport {
  return {
    compactThread: async (threadId) => {
      const result = await withConnectedChatAppServerClient(host, async (client) => {
        await compactThread(client, threadId);
        return true;
      });
      return result ?? false;
    },
    forkThread: (threadId, lastTurnId = null) =>
      withConnectedChatAppServerClient(host, (client) => forkThread(client, threadId, host.vaultPath, lastTurnId)),
    rollbackThread: (threadId) =>
      withConnectedChatAppServerClient(host, async (client): Promise<ThreadRollbackSnapshot> => {
        const snapshot = await rollbackThread(client, threadId);
        return {
          thread: snapshot.thread,
          cwd: snapshot.cwd,
          items: threadStreamItemsFromTurns(snapshot.turns),
        };
      }),
  };
}

function createChatThreadGoalReadTransport(host: CurrentChatAppServerClientHost): ThreadGoalReadTransport {
  return {
    readThreadGoal: (threadId) => readThreadGoalFromCurrentClient(host, threadId),
  };
}

function createChatThreadGoalTransport(host: ConnectedChatAppServerClientHost): ThreadGoalTransport {
  return {
    ensureConnected: async () => (await host.connectedClient()) !== null,
    readThreadGoal: (threadId) => readThreadGoalFromCurrentClient(host, threadId),
    setThreadGoal: async (threadId, params) => {
      const client = await host.connectedClient();
      if (!client) return undefined;
      const goal = await setThreadGoal(client, threadId, params);
      return chatAppServerClientIsStale(host, client) ? undefined : goal;
    },
    clearThreadGoal: async (threadId) => {
      const result = await withConnectedChatAppServerClient(host, async (client) => {
        await clearThreadGoal(client, threadId);
        return true;
      });
      return result ?? false;
    },
    recordThreadGoalUserMessage: async (threadId, objective) => {
      const result = await withCurrentChatAppServerClient(host, async (client) => {
        await recordThreadGoalUserMessage(client, threadId, objective);
        return true;
      });
      return result ?? false;
    },
  };
}

function chatAppServerClientIsStale(host: CurrentChatAppServerClientHost, client: AppServerClient): boolean {
  return host.currentClient() !== client;
}

async function withConnectedChatAppServerClient<T>(
  host: ConnectedChatAppServerClientHost,
  operation: (client: AppServerClient) => Promise<T>,
): Promise<T | null> {
  const client = await host.connectedClient();
  if (!client) return null;
  const result = await operation(client);
  return chatAppServerClientIsStale(host, client) ? null : result;
}

async function withCurrentChatAppServerClient<T>(
  host: CurrentChatAppServerClientHost,
  operation: (client: AppServerClient) => Promise<T>,
): Promise<T | null> {
  const client = host.currentClient();
  if (!client) return null;
  const result = await operation(client);
  return chatAppServerClientIsStale(host, client) ? null : result;
}

async function readChatThreadHistoryPage(
  client: ChatThreadHistoryClient,
  threadId: string,
  cursor: string | null,
  limit = 20,
): Promise<ThreadHistoryPage> {
  return chatThreadHistoryPageFromTurnsPage(threadTurnsPageFromAppServerPage(await listThreadTurns(client, threadId, cursor, limit)));
}

function chatThreadHistoryPageFromTurnsPage(page: ThreadTurnsPage): ThreadHistoryPage {
  return {
    items: threadStreamItemsFromTurns(page.turns),
    nextCursor: page.nextCursor,
    hadTurns: page.turns.length > 0,
  };
}

async function resumeChatThread(client: ChatThreadResumeClient, threadId: string, cwd: string): Promise<ThreadResumeSnapshot> {
  const response = await resumeThread(client, threadId, cwd);
  return {
    activation: threadActivationSnapshotFromAppServerResponse(response),
    rolloutPath: response.thread.path,
    initialHistoryPage: response.initialTurnsPage
      ? chatThreadHistoryPageFromTurnsPage(threadTurnsPageFromAppServerPage(response.initialTurnsPage))
      : null,
  };
}

async function readThreadGoalFromCurrentClient(
  host: CurrentChatAppServerClientHost,
  threadId: string,
): ReturnType<ThreadGoalReadTransport["readThreadGoal"]> {
  const client = host.currentClient();
  if (!client) return undefined;
  const goal = await readThreadGoal(client, threadId);
  return chatAppServerClientIsStale(host, client) ? undefined : goal;
}

function threadTurnsPageFromAppServerPage(page: AppServerThreadTurnsPage): ThreadTurnsPage {
  return {
    turns: page.data,
    nextCursor: page.nextCursor,
  };
}
