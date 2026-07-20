import type { AppServerClient } from "../../../../app-server/connection/client";
import type { AppServerRequestClient } from "../../../../app-server/services/request-client";
import {
  clearThreadGoal,
  compactThread,
  EphemeralThreadCleanupRequiredError,
  forkEphemeralThread,
  forkThread,
  listThreadTurns,
  readThreadGoal,
  recordThreadGoalUserMessage,
  resumeThread,
  rollbackThread,
  setThreadGoal,
  startThread,
  threadActivationSnapshotFromAppServerResponse,
  unsubscribeThread,
  updateThreadSettings,
} from "../../../../app-server/services/threads";
import { interruptTurn, startTurn, steerTurn } from "../../../../app-server/services/turns";
import type { RuntimeSettingsPatch } from "../../../../domain/runtime/thread-settings";
import type { ThreadTurnsPage } from "../../../../domain/threads/history";
import type { EffectOutcome } from "../../application/effect-outcome";
import type { RuntimeSettingsTransport } from "../../application/runtime/settings-transport";
import type { EphemeralThreadForkResult, EphemeralThreadTransport } from "../../application/threads/ephemeral-thread-transport";
import type { ThreadGoalReadTransport, ThreadGoalTransport } from "../../application/threads/goal-transport";
import type {
  ThreadHistoryPage,
  ThreadHistoryTransport,
  ThreadResumeSnapshot,
  ThreadResumeTransport,
} from "../../application/threads/thread-loading-transport";
import type { ThreadMutationTransport, ThreadRollbackSnapshot } from "../../application/threads/thread-mutation-transport";
import type { ThreadStartTransport } from "../../application/threads/thread-start-transport";
import type { ThreadSubscriptionTransport } from "../../application/threads/thread-subscription-transport";
import type { ChatTurnTransport } from "../../application/turns/turn-transport";
import { threadStreamItemsFromTurns } from "../mappers/thread-stream/turn-items";

interface CurrentChatAppServerClientHost {
  currentClient(): AppServerClient | null;
}

interface ConnectedChatAppServerClientHost extends CurrentChatAppServerClientHost {
  connectedClient(): Promise<AppServerClient | null>;
}

interface ChatCurrentAppServerTransportHost extends CurrentChatAppServerClientHost {
  vaultPath: string;
}

interface ChatAppServerTransportHost extends ConnectedChatAppServerClientHost, ChatCurrentAppServerTransportHost {}

interface AppServerThreadTurnsPage {
  readonly data: ThreadTurnsPage["turns"];
  readonly nextCursor: string | null;
}

export interface ChatCurrentSessionTransports {
  readonly runtimeSettings: RuntimeSettingsTransport;
  readonly threadStart: ThreadStartTransport;
  readonly threadHistory: ThreadHistoryTransport;
  readonly threadGoalRead: ThreadGoalReadTransport;
}

export interface ChatConnectedSessionTransports {
  readonly turn: ChatTurnTransport;
  readonly threadResume: ThreadResumeTransport;
  readonly threadMutation: ThreadMutationTransport;
  readonly threadEphemeral: EphemeralThreadTransport;
  readonly threadSubscription: ThreadSubscriptionTransport;
  readonly threadGoal: ThreadGoalTransport;
}

export function createChatCurrentSessionTransports(host: ChatCurrentAppServerTransportHost): ChatCurrentSessionTransports {
  return {
    runtimeSettings: createChatRuntimeSettingsTransport(host),
    threadStart: createChatThreadStartTransport(host),
    threadHistory: createChatThreadHistoryTransport(host),
    threadGoalRead: createChatThreadGoalReadTransport(host),
  };
}

export function createChatConnectedSessionTransports(host: ChatAppServerTransportHost): ChatConnectedSessionTransports {
  return {
    turn: createChatTurnTransport(host),
    threadResume: createChatThreadResumeTransport(host),
    threadMutation: createChatThreadMutationTransport(host),
    threadEphemeral: createChatEphemeralThreadTransport(host),
    threadSubscription: createChatThreadSubscriptionTransport(host),
    threadGoal: createChatThreadGoalTransport(host),
  };
}

function createChatThreadStartTransport(host: ChatCurrentAppServerTransportHost): ThreadStartTransport {
  return {
    startThread: (request) =>
      runCurrentChatAppServerEffect(host, async (client) => {
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
      runCurrentChatAppServerEffect(host, async (client) => {
        const response = await startTurn(client, {
          threadId: request.threadId,
          cwd: host.vaultPath,
          input: request.input,
          clientUserMessageId: request.clientUserMessageId,
        });
        return { turnId: response.turn.id };
      }),
    steerTurn: (request) =>
      runCurrentChatAppServerEffect(host, async (client) => {
        await steerTurn(client, request.threadId, request.turnId, request.input, request.clientUserMessageId);
      }),
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
    ensureConnected: async () => (await host.connectedClient()) !== null,
    resumeThread: (threadId): Promise<EffectOutcome<ThreadResumeSnapshot>> =>
      runCurrentChatAppServerEffect(host, (client) => resumeChatThread(client, threadId, host.vaultPath)),
  };
}

function createChatThreadMutationTransport(host: ChatAppServerTransportHost): ThreadMutationTransport {
  return {
    ensureConnected: async () => (await host.connectedClient()) !== null,
    compactThread: (threadId) =>
      runCurrentChatAppServerEffect(host, async (client) => {
        await compactThread(client, threadId);
      }),
    forkThread: (threadId, lastTurnId = null) =>
      runCurrentChatAppServerEffect(host, (client) => forkThread(client, threadId, host.vaultPath, lastTurnId)),
    rollbackThread: (threadId) =>
      runCurrentChatAppServerEffect(host, async (client): Promise<ThreadRollbackSnapshot> => {
        const snapshot = await rollbackThread(client, threadId);
        return {
          thread: snapshot.thread,
          items: threadStreamItemsFromTurns(snapshot.turns),
        };
      }),
  };
}

function createChatEphemeralThreadTransport(host: ChatAppServerTransportHost): EphemeralThreadTransport {
  return {
    forkEphemeralThread: async (sourceThreadId) => {
      const client = host.currentClient();
      if (!client) return { kind: "not-started" };
      const value = await forkEphemeralThreadResult(client, sourceThreadId, host.vaultPath);
      if (!chatAppServerClientIsStale(host, client)) return { kind: "completed-current", value };
      const threadId = value.kind === "ready" ? value.activation.thread.id : value.threadId;
      try {
        await unsubscribeThread(client, threadId, { timeoutMs: 5_000 });
      } catch {
        // The superseded connection remains the only valid cleanup context.
      }
      return { kind: "completed-stale", value };
    },
    unsubscribeEphemeralThread: async (threadId) => {
      const result = await withCurrentChatAppServerClient(host, async (client) => {
        await unsubscribeThread(client, threadId, { timeoutMs: 5_000 });
        return true;
      });
      return result ?? false;
    },
  };
}

async function forkEphemeralThreadResult(
  client: AppServerRequestClient,
  sourceThreadId: string,
  vaultPath: string,
): Promise<EphemeralThreadForkResult> {
  try {
    const snapshot = await forkEphemeralThread(client, sourceThreadId, vaultPath);
    return { kind: "ready", ...snapshot };
  } catch (error) {
    if (error instanceof EphemeralThreadCleanupRequiredError) {
      return { kind: "cleanup-required", threadId: error.threadId };
    }
    throw error;
  }
}

function createChatThreadSubscriptionTransport(host: ChatAppServerTransportHost): ThreadSubscriptionTransport {
  return {
    unsubscribeThread: async (threadId) => {
      const result = await withCurrentChatAppServerClient(host, async (client) => {
        await unsubscribeThread(client, threadId, { timeoutMs: 5_000 });
        return true;
      });
      return result ?? false;
    },
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
      return runCurrentChatAppServerEffect(host, (client) => setThreadGoal(client, threadId, params));
    },
    clearThreadGoal: (threadId) =>
      runCurrentChatAppServerEffect(host, async (client) => {
        await clearThreadGoal(client, threadId);
      }),
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

function runCurrentChatAppServerEffect<T>(
  host: CurrentChatAppServerClientHost,
  operation: (client: AppServerClient) => Promise<T>,
): Promise<EffectOutcome<T>> {
  const client = host.currentClient();
  if (!client) return Promise.resolve({ kind: "not-started" });
  const effect = operation(client);
  return effect.then((value) =>
    chatAppServerClientIsStale(host, client) ? { kind: "completed-stale", value } : { kind: "completed-current", value },
  );
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
  client: AppServerRequestClient,
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

async function resumeChatThread(client: AppServerRequestClient, threadId: string, cwd: string): Promise<ThreadResumeSnapshot> {
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
