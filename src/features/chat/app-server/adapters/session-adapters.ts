import type { AppServerClient } from "../../../../app-server/connection/client";
import { AppServerRpcError } from "../../../../app-server/connection/json-rpc-client";
import type { AppServerRequestClient } from "../../../../app-server/services/request-client";
import {
  clearThreadGoal,
  compactThread,
  forkThread,
  listThreadTurns,
  resumeThread,
  setThreadGoal,
  startThread,
  threadActivationSnapshotFromAppServerResponse,
  unsubscribeThread,
  updateThreadSettings,
} from "../../../../app-server/services/threads";
import { interruptTurn, startTurn, steerTurn } from "../../../../app-server/services/turns";
import { type CodexInput, OBSIDIAN_CONTEXT_ADDITIONAL_CONTEXT_KEY } from "../../../../domain/input/input";
import type { RuntimeSettingsPatch } from "../../../../domain/runtime/settings";
import type { EffectOutcome } from "../../application/effect-outcome";
import type { RuntimeSettingsPort } from "../../application/runtime/settings-commands";
import type { EphemeralThreadEffects, EphemeralThreadForkResult } from "../../application/threads/ephemeral-thread-lifecycle";
import type { ThreadGoalEffects } from "../../application/threads/goal-commands";
import type { ThreadHistoryPage, ThreadHistorySource } from "../../application/threads/history-controller";
import type { ThreadResumeEffects, ThreadResumeSnapshot } from "../../application/threads/resume-command";
import type { ThreadCommandEffects } from "../../application/threads/thread-commands";
import type { ThreadStartEffects } from "../../application/threads/thread-start-command";
import type { ChatTurnPort } from "../../application/turns/turn-port";
import { chatThreadHistoryPageFromTurnsPage } from "../mappers/thread-stream/turn-items";
import { panelDynamicTools } from "./dynamic-tool-registration";
import { EphemeralThreadCleanupRequiredError, forkEphemeralThread } from "./side-chat";

interface CurrentChatAppServerClientHost {
  currentClient(): AppServerClient | null;
}

interface ChatAppServerAdapterHost extends CurrentChatAppServerClientHost {
  vaultPath: string;
}

interface ChatAppServerSessionAdapterHost extends ChatAppServerAdapterHost {
  threadExecutionContexts: Map<string, ThreadExecutionContext>;
}

interface ThreadExecutionContext {
  readonly cwd: string;
  readonly runtimeWorkspaceRoots: readonly string[];
}

export function createChatSessionAdapters(host: ChatAppServerAdapterHost) {
  const sessionHost: ChatAppServerSessionAdapterHost = { ...host, threadExecutionContexts: new Map<string, ThreadExecutionContext>() };
  return {
    runtimeSettings: createChatRuntimeSettingsAdapter(sessionHost),
    threadStart: createChatThreadStartAdapter(sessionHost),
    threadHistory: createChatThreadHistoryAdapter(sessionHost),
    turn: createChatTurnAdapter(sessionHost),
    threadResume: createChatThreadResumeAdapter(sessionHost),
    threadCommands: createChatThreadCommandAdapter(sessionHost),
    threadEphemeral: createChatEphemeralThreadAdapter(sessionHost),
    threadSubscription: createChatThreadSubscriptionAdapter(sessionHost),
    threadGoal: createChatThreadGoalAdapter(sessionHost),
  } as const;
}

export type ChatSessionAdapters = ReturnType<typeof createChatSessionAdapters>;

function createChatThreadStartAdapter(host: ChatAppServerSessionAdapterHost): ThreadStartEffects {
  return {
    forkThread: (threadId, options) =>
      runCurrentChatAppServerEffect(host, async (client) => {
        const executionContext = executionContextForThread(host, threadId);
        const activation = await forkThread(client, threadId, executionContext.cwd, {
          ...options,
          runtime: {
            ...options.runtime,
            ...(executionContext.runtimeWorkspaceRoots.length > 0 ? { runtimeWorkspaceRoots: executionContext.runtimeWorkspaceRoots } : {}),
          },
        });
        rememberThreadExecutionContext(host, activation);
        return activation;
      }),
    startThread: (request) =>
      runCurrentChatAppServerEffect(host, async (client) => {
        const response = await startThread(client, {
          cwd: host.vaultPath,
          serviceTier: request.serviceTier,
          permissions: request.permissions,
          dynamicTools: panelDynamicTools(),
        });
        const activation = threadActivationSnapshotFromAppServerResponse(response);
        rememberThreadExecutionContext(host, activation);
        return activation;
      }),
  };
}

function createChatTurnAdapter(host: ChatAppServerSessionAdapterHost): ChatTurnPort {
  return {
    startTurn: (request) =>
      runCurrentChatAppServerEffect(host, async (client) => {
        const executionContext = executionContextForThread(host, request.threadId);
        const runtimeWorkspaceRoots = workspaceRootsForInput(executionContext, request.input, host.vaultPath);
        const response = await startTurn(client, {
          threadId: request.threadId,
          cwd: executionContext.cwd,
          ...(runtimeWorkspaceRoots === undefined ? {} : { runtimeWorkspaceRoots }),
          input: request.input,
          clientUserMessageId: request.clientUserMessageId,
        });
        if (runtimeWorkspaceRoots !== undefined) {
          host.threadExecutionContexts.set(request.threadId, { ...executionContext, runtimeWorkspaceRoots });
        }
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

function createChatThreadResumeAdapter(host: ChatAppServerSessionAdapterHost): ThreadResumeEffects {
  return {
    resumeThread: (threadId): Promise<EffectOutcome<ThreadResumeSnapshot>> =>
      runCurrentChatAppServerEffect(host, async (client) => {
        const snapshot = await resumeChatThread(client, threadId);
        rememberThreadExecutionContext(host, snapshot.activation);
        return snapshot;
      }),
  };
}

function executionContextForThread(host: ChatAppServerSessionAdapterHost, threadId: string): ThreadExecutionContext {
  return host.threadExecutionContexts.get(threadId) ?? { cwd: host.vaultPath, runtimeWorkspaceRoots: [] };
}

function rememberThreadExecutionContext(host: ChatAppServerSessionAdapterHost, activation: ThreadResumeSnapshot["activation"]): void {
  if (!activation.thread.cwd) return;
  host.threadExecutionContexts.set(activation.thread.id, {
    cwd: activation.thread.cwd,
    runtimeWorkspaceRoots: activation.runtimeWorkspaceRoots ?? [],
  });
}

function workspaceRootsForInput(
  context: ThreadExecutionContext,
  input: string | CodexInput,
  vaultPath: string,
): readonly string[] | undefined {
  if (!containsObsidianContext(input) || context.runtimeWorkspaceRoots.includes(vaultPath)) return undefined;
  return [...new Set([...context.runtimeWorkspaceRoots, vaultPath])];
}

function containsObsidianContext(input: string | CodexInput): boolean {
  return (
    Array.isArray(input) &&
    input.some(
      (item) =>
        (item.type === "additionalContext" && item.key === OBSIDIAN_CONTEXT_ADDITIONAL_CONTEXT_KEY && item.value.trim().length > 0) ||
        (item.type === "fileReference" && item.path.trim().length > 0),
    )
  );
}

function createChatThreadCommandAdapter(host: ChatAppServerAdapterHost): ThreadCommandEffects {
  return {
    compactThread: (threadId) => runCurrentChatAppServerEffect(host, async (client) => compactThread(client, threadId)),
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
  return chatThreadHistoryPageFromTurnsPage(await listThreadTurns(client, threadId, cursor, limit));
}

async function resumeChatThread(client: AppServerRequestClient, threadId: string): Promise<ThreadResumeSnapshot> {
  const response = await resumeThread(client, threadId);
  return {
    activation: threadActivationSnapshotFromAppServerResponse(response),
    rolloutPath: response.thread.path,
    initialHistoryPage: response.initialTurnsPage ? chatThreadHistoryPageFromTurnsPage(response.initialTurnsPage) : null,
  };
}
