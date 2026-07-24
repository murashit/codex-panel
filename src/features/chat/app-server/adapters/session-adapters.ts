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
import type { RuntimeSettingsPort } from "../../application/runtime/settings-port";
import type { EphemeralThreadForkResult, EphemeralThreadPort } from "../../application/threads/ephemeral-thread-port";
import type { ThreadGoalPort, ThreadGoalReadPort } from "../../application/threads/goal-ports";
import type { ThreadCommandPort } from "../../application/threads/thread-command-ports";
import type {
  ThreadHistoryPage,
  ThreadHistoryPort,
  ThreadResumePort,
  ThreadResumeSnapshot,
} from "../../application/threads/thread-loading-ports";
import type { ThreadStartPort } from "../../application/threads/thread-start-port";
import type { ThreadSubscriptionPort } from "../../application/threads/thread-subscription-port";
import type { ChatTurnPort } from "../../application/turns/turn-port";
import { threadStreamItemsFromTurns } from "../mappers/thread-stream/turn-items";

interface CurrentChatAppServerClientHost {
  currentClient(): AppServerClient | null;
}

interface ConnectedChatAppServerClientHost extends CurrentChatAppServerClientHost {
  connectedClient(): Promise<AppServerClient | null>;
}

interface ChatCurrentAppServerAdapterHost extends CurrentChatAppServerClientHost {
  vaultPath: string;
}

interface ChatAppServerAdapterHost extends ConnectedChatAppServerClientHost, ChatCurrentAppServerAdapterHost {}

interface AppServerThreadTurnsPage {
  readonly data: ThreadTurnsPage["turns"];
  readonly nextCursor: string | null;
}

export function createChatCurrentSessionAdapters(host: ChatCurrentAppServerAdapterHost) {
  return {
    runtimeSettings: createChatRuntimeSettingsAdapter(host),
    threadStart: createChatThreadStartAdapter(host),
    threadHistory: createChatThreadHistoryAdapter(host),
    threadGoalRead: createChatThreadGoalReadAdapter(host),
  } as const;
}

export type ChatCurrentSessionAdapters = ReturnType<typeof createChatCurrentSessionAdapters>;

export function createChatConnectedSessionAdapters(host: ChatAppServerAdapterHost) {
  return {
    turn: createChatTurnAdapter(host),
    threadResume: createChatThreadResumeAdapter(host),
    threadCommands: createChatThreadCommandAdapter(host),
    threadEphemeral: createChatEphemeralThreadAdapter(host),
    threadSubscription: createChatThreadSubscriptionAdapter(host),
    threadGoal: createChatThreadGoalAdapter(host),
  } as const;
}

export type ChatConnectedSessionAdapters = ReturnType<typeof createChatConnectedSessionAdapters>;

function createChatThreadStartAdapter(host: ChatCurrentAppServerAdapterHost): ThreadStartPort {
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

function createChatTurnAdapter(host: ChatAppServerAdapterHost): ChatTurnPort {
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

function createChatRuntimeSettingsAdapter(host: CurrentChatAppServerClientHost): RuntimeSettingsPort {
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

function createChatThreadHistoryAdapter(host: CurrentChatAppServerClientHost): ThreadHistoryPort {
  return {
    readHistoryPage: (threadId, cursor, limit): Promise<ThreadHistoryPage | null> =>
      withCurrentChatAppServerClient(host, (client) => readChatThreadHistoryPage(client, threadId, cursor, limit)),
  };
}

function createChatThreadResumeAdapter(host: ChatAppServerAdapterHost): ThreadResumePort {
  return {
    ensureConnected: async () => (await host.connectedClient()) !== null,
    resumeThread: (threadId): Promise<EffectOutcome<ThreadResumeSnapshot>> =>
      runCurrentChatAppServerEffect(host, (client) => resumeChatThread(client, threadId, host.vaultPath)),
  };
}

function createChatThreadCommandAdapter(host: ChatAppServerAdapterHost): ThreadCommandPort {
  return {
    ensureConnected: async () => (await host.connectedClient()) !== null,
    compactThread: (threadId) =>
      runCurrentChatAppServerEffect(host, async (client) => {
        await compactThread(client, threadId);
      }),
    forkThread: (threadId, options) =>
      runCurrentChatAppServerEffect(host, (client) => forkThread(client, threadId, host.vaultPath, options)),
  };
}

function createChatEphemeralThreadAdapter(host: ChatAppServerAdapterHost): EphemeralThreadPort {
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

function createChatThreadSubscriptionAdapter(host: ChatAppServerAdapterHost): ThreadSubscriptionPort {
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

function createChatThreadGoalReadAdapter(host: CurrentChatAppServerClientHost): ThreadGoalReadPort {
  return {
    readThreadGoal: (threadId) => readThreadGoalFromCurrentClient(host, threadId),
  };
}

function createChatThreadGoalAdapter(host: ConnectedChatAppServerClientHost): ThreadGoalPort {
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
): ReturnType<ThreadGoalReadPort["readThreadGoal"]> {
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
