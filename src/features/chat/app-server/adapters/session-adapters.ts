import type { AppServerClient } from "../../../../app-server/connection/client";
import { AppServerRpcError } from "../../../../app-server/connection/json-rpc-client";
import type { AppServerRequestClient } from "../../../../app-server/services/request-client";
import {
  clearThreadGoal,
  compactThread,
  forkThread,
  listThreadTurns,
  readThreadGoal,
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
import type { EphemeralThreadEffects, EphemeralThreadForkResult } from "../../application/threads/ephemeral-thread-lifecycle";
import type { ThreadGoalEffects } from "../../application/threads/goal-commands";
import type { ThreadGoalSource } from "../../application/threads/goal-sync";
import type { ThreadHistoryPage, ThreadHistorySource } from "../../application/threads/history-controller";
import type { ThreadResumeEffects, ThreadResumeSnapshot } from "../../application/threads/resume-command";
import type { ThreadCommandEffects } from "../../application/threads/thread-commands";
import type { ThreadStartEffects } from "../../application/threads/thread-start-command";
import type { ChatTurnPort } from "../../application/turns/turn-port";
import { threadStreamItemsFromTurns } from "../mappers/thread-stream/turn-items";
import { EphemeralThreadCleanupRequiredError, forkEphemeralThread } from "./side-chat";

interface CurrentChatAppServerClientHost {
  currentClient(): AppServerClient | null;
}

interface ChatAppServerAdapterHost extends CurrentChatAppServerClientHost {
  vaultPath: string;
}

interface AppServerThreadTurnsPage {
  readonly data: ThreadTurnsPage["turns"];
  readonly nextCursor: string | null;
}

export function createChatSessionAdapters(host: ChatAppServerAdapterHost) {
  return {
    runtimeSettings: createChatRuntimeSettingsAdapter(host),
    threadStart: createChatThreadStartAdapter(host),
    threadHistory: createChatThreadHistoryAdapter(host),
    threadGoalRead: createChatThreadGoalReadAdapter(host),
    turn: createChatTurnAdapter(host),
    threadResume: createChatThreadResumeAdapter(host),
    threadCommands: createChatThreadCommandAdapter(host),
    threadEphemeral: createChatEphemeralThreadAdapter(host),
    threadSubscription: createChatThreadSubscriptionAdapter(host),
    threadGoal: createChatThreadGoalAdapter(host),
  } as const;
}

export type ChatSessionAdapters = ReturnType<typeof createChatSessionAdapters>;

function createChatThreadStartAdapter(host: ChatAppServerAdapterHost): ThreadStartEffects {
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
    steerTurn: async (request) => {
      const client = host.currentClient();
      if (!client) return { kind: "not-started" };
      const dispatch = steerTurn(client, request.threadId, request.turnId, request.input, request.clientUserMessageId);
      if (dispatch.kind === "not-dispatched") {
        return { kind: "failed", error: dispatch.error };
      }
      try {
        await dispatch.completion;
      } catch (error) {
        return error instanceof AppServerRpcError ? { kind: "failed", error } : { kind: "delivery-unknown" };
      }
      return { kind: "completed", value: undefined };
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

function createChatThreadHistoryAdapter(host: CurrentChatAppServerClientHost): ThreadHistorySource {
  return {
    readHistoryPage: (threadId, cursor, limit): Promise<ThreadHistoryPage | null> =>
      withCurrentChatAppServerClient(host, (client) => readChatThreadHistoryPage(client, threadId, cursor, limit)),
  };
}

function createChatThreadResumeAdapter(host: ChatAppServerAdapterHost): ThreadResumeEffects {
  return {
    resumeThread: (threadId): Promise<EffectOutcome<ThreadResumeSnapshot>> =>
      runCurrentChatAppServerEffect(host, (client) => resumeChatThread(client, threadId, host.vaultPath)),
  };
}

function createChatThreadCommandAdapter(host: ChatAppServerAdapterHost): ThreadCommandEffects {
  return {
    compactThread: (threadId) => runCurrentChatAppServerEffect(host, async (client) => compactThread(client, threadId)),
    forkThread: (threadId, options) =>
      runCurrentChatAppServerEffect(host, (client) => forkThread(client, threadId, host.vaultPath, options)),
  };
}

function createChatEphemeralThreadAdapter(host: ChatAppServerAdapterHost): EphemeralThreadEffects {
  return {
    forkEphemeralThread: async (sourceThreadId) => {
      const client = host.currentClient();
      if (!client) return null;
      const value = await forkEphemeralThreadResult(client, sourceThreadId, host.vaultPath);
      if (!chatAppServerClientIsStale(host, client)) return value;
      const threadId = value.kind === "ready" ? value.activation.thread.id : value.threadId;
      try {
        await unsubscribeThread(client, threadId, { timeoutMs: 5_000 });
      } catch {
        // The superseded connection remains the only valid cleanup context.
      }
      return null;
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

function createChatThreadSubscriptionAdapter(host: ChatAppServerAdapterHost) {
  return {
    unsubscribeThread: async (threadId: string) => {
      const result = await withCurrentChatAppServerClient(host, async (client) => {
        await unsubscribeThread(client, threadId, { timeoutMs: 5_000 });
        return true;
      });
      return result ?? false;
    },
  };
}

function createChatThreadGoalReadAdapter(host: CurrentChatAppServerClientHost): ThreadGoalSource {
  return {
    readThreadGoal: (threadId) => readThreadGoalFromCurrentClient(host, threadId),
  };
}

function createChatThreadGoalAdapter(host: CurrentChatAppServerClientHost): ThreadGoalEffects {
  return {
    setThreadGoal: async (threadId, params) => runCurrentChatAppServerEffect(host, (client) => setThreadGoal(client, threadId, params)),
    clearThreadGoal: (threadId) => runCurrentChatAppServerEffect(host, async (client) => clearThreadGoal(client, threadId)),
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
  return operation(client).then((value) => ({ kind: "completed", value }));
}

async function withCurrentChatAppServerClient<T>(
  host: CurrentChatAppServerClientHost,
  operation: (client: AppServerClient) => Promise<T>,
): Promise<T | null> {
  const client = host.currentClient();
  if (!client) return null;
  return operation(client);
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
): ReturnType<ThreadGoalSource["readThreadGoal"]> {
  const client = host.currentClient();
  if (!client) return undefined;
  return readThreadGoal(client, threadId);
}

function threadTurnsPageFromAppServerPage(page: AppServerThreadTurnsPage): ThreadTurnsPage {
  return {
    turns: page.data,
    nextCursor: page.nextCursor,
  };
}
