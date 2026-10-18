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
  updateThreadSettings,
} from "../../../../app-server/services/threads";
import { interruptTurn, startTurn, steerTurn } from "../../../../app-server/services/turns";
import type { RuntimeSettingsPatch } from "../../../../domain/runtime/settings";
import type { EffectOutcome } from "../../application/effect-outcome";
import type { RuntimeSettingsPort } from "../../application/runtime/settings-commands";
import type { ThreadGoalEffects } from "../../application/threads/goal-commands";
import type { ThreadHistoryPage, ThreadHistorySource } from "../../application/threads/history-controller";
import type { ThreadResumeEffects } from "../../application/threads/resume-command";
import type { SideChatPort } from "../../application/threads/side-chat-commands";
import type { ThreadCommandEffects } from "../../application/threads/thread-commands";
import type { ThreadStartEffects } from "../../application/threads/thread-start-command";
import type { ChatTurnPort } from "../../application/turns/turn-port";
import { chatThreadHistoryPageFromNewestFirstTurnsPage } from "../mappers/thread-stream/turn-items";
import { panelDynamicTools } from "./dynamic-tool-registration";
import { createSideConversation, type SideConversation, type SideConversationFactory } from "./side-chat";

interface CurrentChatAppServerClientHost {
  currentClient(): AppServerClient | null;
}

interface ChatAppServerAdapterHost extends CurrentChatAppServerClientHost {
  vaultPath: string;
  recordThreadSubscription(threadId: string, client: AppServerClient): void;
  releaseThreadRequests?: (threadId: string) => void;
  reportCleanupFailure?: () => void;
  createSideConversation?: SideConversationFactory;
  currentTurn?: () => { threadId: string; turnId: string } | null;
}

export function createChatSessionAdapters(host: ChatAppServerAdapterHost) {
  let sideChat: { threadId: string | null; conversation: SideConversation } | null = null;
  let disposed = false;
  const releaseSideChat = (): Promise<void> => {
    const conversation = sideChat?.conversation;
    sideChat = null;
    return conversation?.release() ?? Promise.resolve();
  };
  const ephemeral: SideChatPort = {
    async forkEphemeralThread(sourceThreadId, runtime, isCurrent) {
      const client = host.currentClient();
      if (!client || disposed) return null;
      const current = (): boolean => !disposed && sideChat === owned && host.currentClient() === client && isCurrent();
      const conversation = (host.createSideConversation ?? createSideConversation)({
        client,
        sourceThreadId,
        runtime,
        vaultPath: host.vaultPath,
        isCurrent: current,
        ...(host.currentTurn ? { currentTurn: host.currentTurn } : {}),
        releaseRequests: (threadId) => host.releaseThreadRequests?.(threadId),
        reportCleanupFailure: () => host.reportCleanupFailure?.(),
      });
      const owned = { threadId: null as string | null, conversation };
      sideChat = owned;
      const activation = await conversation.activate();
      if (!activation || !current()) {
        void conversation.release().catch(() => undefined);
        return null;
      }
      owned.threadId = activation.thread.id;
      return activation;
    },
    release: releaseSideChat,
    dispose() {
      disposed = true;
      return releaseSideChat();
    },
  };
  return {
    runtimeSettings: createChatRuntimeSettingsAdapter(host),
    threadStart: createChatThreadStartAdapter(host),
    threadHistory: createChatThreadHistoryAdapter(host),
    turn: createChatTurnAdapter(host, (threadId) => (sideChat?.threadId === threadId ? sideChat.conversation : null)),
    threadResume: createChatThreadResumeAdapter(host),
    threadCommands: createChatThreadCommandAdapter(host),
    threadEphemeral: ephemeral,
    threadGoal: createChatThreadGoalAdapter(host),
  } as const;
}

export type ChatSessionAdapters = ReturnType<typeof createChatSessionAdapters>;

function createChatThreadStartAdapter(host: ChatAppServerAdapterHost): ThreadStartEffects {
  return {
    forkThread: (threadId, options) =>
      runCurrentChatAppServerEffect(host, async (client) => {
        const activation = await forkThread(client, threadId, host.vaultPath, options);
        host.recordThreadSubscription(activation.thread.id, client);
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
        host.recordThreadSubscription(response.thread.id, client);
        return threadActivationSnapshotFromAppServerResponse(response);
      }),
  };
}

function createChatTurnAdapter(host: ChatAppServerAdapterHost, sideChatFor: (threadId: string) => SideConversation | null): ChatTurnPort {
  return {
    startTurn: (request) =>
      runCurrentChatAppServerEffect(host, async (client) => {
        const sideChat = sideChatFor(request.threadId);
        if (sideChat) return sideChat.start(request.input, request.clientUserMessageId);
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
    resumeThread: async (threadId, adopt) => {
      const client = host.currentClient();
      if (!client) return;
      await resumeThread(client, threadId, host.vaultPath, (response) => {
        host.recordThreadSubscription(response.thread.id, client);
        adopt({
          activation: threadActivationSnapshotFromAppServerResponse(response),
          rolloutPath: response.thread.path,
          activeTurnId: response.initialTurnsPage?.data.find((turn) => turn.status === "inProgress")?.id ?? null,
          initialHistoryPage: response.initialTurnsPage ? chatThreadHistoryPageFromNewestFirstTurnsPage(response.initialTurnsPage) : null,
        });
      });
    },
  };
}

function createChatThreadCommandAdapter(host: ChatAppServerAdapterHost): ThreadCommandEffects {
  return {
    compactThread: (threadId) => runCurrentChatAppServerEffect(host, async (client) => compactThread(client, threadId)),
  };
}

function createChatThreadGoalAdapter(host: CurrentChatAppServerClientHost): ThreadGoalEffects {
  return {
    setThreadGoal: async (threadId, params) => runCurrentChatAppServerEffect(host, (client) => setThreadGoal(client, threadId, params)),
    clearThreadGoal: (threadId) => runCurrentChatAppServerEffect(host, async (client) => clearThreadGoal(client, threadId)),
  };
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
  return chatThreadHistoryPageFromNewestFirstTurnsPage(await listThreadTurns(client, threadId, cursor, limit));
}
