import { Notice } from "obsidian";

import type { ConnectionManager } from "../../../app-server/connection-manager";
import type { RuntimeSnapshot } from "../runtime/effective-settings";
import type { ChatStateStore } from "../chat-state";
import type { CodexChatHost } from "../chat-host";
import { createChatServerDiagnosticsActions, type ChatServerDiagnosticsActions } from "../server-actions/diagnostics-actions";
import { createChatServerMetadataActions, type ChatServerMetadataActions } from "../server-actions/metadata-actions";
import { createChatServerThreadActions } from "../server-actions/thread-actions";
import { ChatConnectionController } from "./connection-controller";
import { createChatReconnectActions } from "./reconnect-actions";
import type { rejectServerRequest, respondToServerRequest } from "../requests/server-request-responder";
import type { ChatThreadGoalActions } from "../threads/thread-goal-actions";
import type { ThreadRenameController } from "../threads/thread-rename-controller";
import { ChatInboundController } from "../inbound/controller";
import type { ChatConnectionWorkTracker } from "../panel/lifecycle";

interface ChatServerActionControllerPorts {
  plugin: Pick<CodexChatHost, "applyThreadListSnapshot" | "publishAppServerMetadata" | "vaultPath">;
  state: {
    stateStore: ChatStateStore;
  };
  runtime: {
    runtimeSnapshot: () => RuntimeSnapshot;
  };
}

export function createChatServerActionControllers(
  context: ChatServerActionControllerPorts,
  refs: {
    connection: ConnectionManager;
    goals: ChatThreadGoalActions;
  },
) {
  const { plugin, runtime } = context;
  const stateStore = context.state.stateStore;
  const serverActionHost = {
    stateStore,
    vaultPath: plugin.vaultPath,
    currentClient: () => refs.connection.currentClient(),
  };
  const serverMetadata = createChatServerMetadataActions({
    ...serverActionHost,
    publishAppServerMetadata: (metadata) => {
      plugin.publishAppServerMetadata(metadata);
    },
  });
  const serverDiagnostics = createChatServerDiagnosticsActions({
    ...serverActionHost,
    publishAppServerMetadata: (metadata) => {
      plugin.publishAppServerMetadata(metadata);
    },
    serverMetadataSnapshot: () => serverMetadata.serverMetadataSnapshot(),
  });
  const serverThreads = createChatServerThreadActions({
    ...serverActionHost,
    runtimeSnapshot: runtime.runtimeSnapshot,
    publishThreadList: (threads) => {
      plugin.applyThreadListSnapshot(threads);
    },
    syncThreadGoal: (threadId) => {
      void refs.goals.syncThreadGoal(threadId);
    },
  });

  return { serverThreads, serverMetadata, serverDiagnostics };
}

interface ChatInboundControllerPorts {
  plugin: Pick<CodexChatHost, "notifyThreadArchived" | "notifyThreadRenamed">;
  state: {
    stateStore: ChatStateStore;
  };
  render: {
    schedule: () => void;
  };
  thread: {
    refreshThreads: () => Promise<void>;
    refreshSkills: (forceReload?: boolean) => Promise<void>;
    publishAppServerMetadataSnapshot: () => void;
  };
}

export function createChatInboundController(
  context: ChatInboundControllerPorts,
  refs: {
    serverMetadata: ChatServerMetadataActions;
    serverDiagnostics: ChatServerDiagnosticsActions;
    threadRename: ThreadRenameController;
    respondToServerRequest: (requestId: Parameters<typeof respondToServerRequest>[1], result: unknown) => boolean;
    rejectServerRequest: (requestId: Parameters<typeof rejectServerRequest>[1], code: number, message: string) => boolean;
  },
): ChatInboundController {
  const { plugin, thread, render } = context;

  return new ChatInboundController(context.state.stateStore, {
    refreshThreads: () => {
      void thread.refreshThreads();
    },
    refreshRateLimits: () => {
      void refs.serverMetadata.refreshPublishedRateLimits();
    },
    refreshSkills: (forceReload) => void thread.refreshSkills(forceReload),
    publishAppServerMetadata: thread.publishAppServerMetadataSnapshot,
    maybeNameThread: (threadId, turn) => {
      refs.threadRename.maybeAutoNameThread(threadId, turn);
    },
    notifyThreadArchived: plugin.notifyThreadArchived.bind(plugin),
    notifyThreadRenamed: plugin.notifyThreadRenamed.bind(plugin),
    recordMcpStartupStatus: (name, status, message) => {
      refs.serverDiagnostics.recordMcpStartupStatus(name, status, message);
      render.schedule();
    },
    respondToServerRequest: refs.respondToServerRequest,
    rejectServerRequest: refs.rejectServerRequest,
  });
}

interface ChatConnectionControllerPorts {
  plugin: Pick<CodexChatHost, "settings">;
  state: {
    stateStore: ChatStateStore;
  };
  client: {
    setClient: (client: ReturnType<ConnectionManager["currentClient"]>) => void;
  };
  lifecycle: {
    connectionWork: ChatConnectionWorkTracker;
    invalidateResumeWork: () => void;
    scheduleDeferredDiagnostics: () => void;
    clearDeferredDiagnostics: () => void;
  };
  thread: {
    loadSharedThreadList: () => Promise<void>;
    refreshTabHeader: () => void;
    resetTurnPresence: (hadTurns: boolean) => void;
  };
  status: {
    set: (status: string) => void;
    addSystemMessage: (text: string) => void;
  };
  liveState: {
    refresh: () => void;
  };
  render: {
    now: () => void;
    schedule: () => void;
  };
}

export function createChatConnectionControllers(
  context: ChatConnectionControllerPorts,
  refs: {
    connection: ConnectionManager;
    serverMetadata: ChatServerMetadataActions;
    serverDiagnostics: ChatServerDiagnosticsActions;
  },
) {
  const { plugin, client, thread, status, liveState, render, lifecycle } = context;
  const { connectionWork } = lifecycle;

  return {
    connectionController: new ChatConnectionController({
      stateStore: context.state.stateStore,
      connection: refs.connection,
      connectionWork,
      metadata: {
        refreshPublishedAppServerMetadata: () => refs.serverMetadata.refreshPublishedAppServerMetadata(),
        refreshPublishedSkills: (forceReload) => refs.serverMetadata.refreshPublishedSkills(forceReload),
      },
      diagnostics: {
        refreshPublishedDiagnosticProbes: () => refs.serverDiagnostics.refreshPublishedDiagnosticProbes(),
      },
      setClient: client.setClient,
      invalidateResumeWork: lifecycle.invalidateResumeWork,
      loadSharedThreadList: thread.loadSharedThreadList,
      scheduleDeferredDiagnostics: lifecycle.scheduleDeferredDiagnostics,
      clearDeferredDiagnostics: lifecycle.clearDeferredDiagnostics,
      refreshTabHeader: thread.refreshTabHeader,
      resetThreadTurnPresence: thread.resetTurnPresence,
      setStatus: status.set,
      addSystemMessage: status.addSystemMessage,
      configuredCommand: () => plugin.settings.codexPath,
      refreshLiveState: liveState.refresh,
      render: render.now,
      scheduleRender: render.schedule,
      notifyConnectionFailed: () => {
        new Notice("Codex app-server connection failed.");
      },
    }),
  };
}

interface ChatReconnectControllerGroupPorts {
  state: {
    stateStore: ChatStateStore;
  };
  client: {
    clear: () => void;
    ensureConnected: () => Promise<void>;
  };
  lifecycle: {
    invalidateConnectionWork: () => void;
    invalidateResumeWork: () => void;
    clearDeferredDiagnostics: () => void;
  };
  render: {
    now: () => void;
  };
  status: {
    set: (status: string) => void;
    addSystemMessage: (text: string) => void;
  };
  thread: {
    resumeThread: (threadId: string) => Promise<void>;
  };
}

export function createChatReconnectControllerGroup(
  context: ChatReconnectControllerGroupPorts,
  refs: {
    connection: ConnectionManager;
  },
) {
  const { client, lifecycle, render, status, thread } = context;

  const reconnectActions = createChatReconnectActions({
    stateStore: context.state.stateStore,
    invalidateConnectionWork: lifecycle.invalidateConnectionWork,
    invalidateResumeWork: lifecycle.invalidateResumeWork,
    clearDeferredDiagnostics: lifecycle.clearDeferredDiagnostics,
    reconnect: () => {
      refs.connection.reconnect();
    },
    clearClient: client.clear,
    setStatus: status.set,
    render: render.now,
    ensureConnected: client.ensureConnected,
    resumeThread: thread.resumeThread,
    addSystemMessage: status.addSystemMessage,
  });

  return { reconnectActions };
}
