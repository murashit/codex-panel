import { Notice } from "obsidian";

import type { ConnectionManager } from "../../../app-server/connection/connection-manager";
import { createChatServerDiagnosticsActions, type ChatServerDiagnosticsActions } from "./server-actions/diagnostics";
import { createChatServerMetadataActions, type ChatServerMetadataActions } from "./server-actions/metadata";
import { createChatServerThreadActions } from "./server-actions/threads";
import { ChatConnectionController } from "./connection-controller";
import { createChatReconnectActions } from "./reconnect-actions";
import type { rejectServerRequest, respondToServerRequest } from "../protocol/server-requests/responder";
import type { GoalActions } from "../threads/goal-actions";
import type { AutoTitleController } from "../threads/auto-title-controller";
import { ChatInboundController } from "../protocol/inbound/controller";
import type { ChatConnectionWorkTracker } from "../lifecycle";
import type { ChatControllerPorts } from "../controller-ports";
import { runtimeSnapshotForChatState } from "../runtime/snapshot";

type ChatServerActionControllerPorts = Pick<ChatControllerPorts, "plugin" | "state">;

export function createChatServerActionControllers(
  context: ChatServerActionControllerPorts,
  refs: {
    connection: ConnectionManager;
    goals: GoalActions;
  },
) {
  const { plugin } = context;
  const { stateStore } = context.state;
  const currentClient = () => refs.connection.currentClient();
  const serverMetadata = createChatServerMetadataActions({
    stateStore,
    vaultPath: plugin.vaultPath,
    currentClient,
    publishAppServerMetadata: (metadata) => {
      plugin.publishAppServerMetadata(metadata);
    },
  });
  const serverDiagnostics = createChatServerDiagnosticsActions({
    stateStore,
    vaultPath: plugin.vaultPath,
    currentClient,
    publishAppServerMetadata: (metadata) => {
      plugin.publishAppServerMetadata(metadata);
    },
    serverMetadataSnapshot: () => serverMetadata.serverMetadataSnapshot(),
  });
  const serverThreads = createChatServerThreadActions({
    stateStore,
    vaultPath: plugin.vaultPath,
    currentClient,
    runtimeSnapshotForState: runtimeSnapshotForChatState,
    publishThreadList: (threads) => {
      plugin.applyThreadListSnapshot(threads);
    },
    syncThreadGoal: (threadId) => {
      void refs.goals.syncThreadGoal(threadId);
    },
  });

  return { serverThreads, serverMetadata, serverDiagnostics };
}

type ChatInboundControllerPorts = Pick<ChatControllerPorts, "plugin" | "state"> & {
  thread: {
    refreshThreads: () => Promise<void>;
    refreshSkills: (forceReload?: boolean) => Promise<void>;
    publishAppServerMetadataSnapshot: () => void;
  };
};

export function createChatInboundController(
  context: ChatInboundControllerPorts,
  refs: {
    serverMetadata: ChatServerMetadataActions;
    serverDiagnostics: ChatServerDiagnosticsActions;
    autoTitle: AutoTitleController;
    respondToServerRequest: (requestId: Parameters<typeof respondToServerRequest>[1], result: unknown) => boolean;
    rejectServerRequest: (requestId: Parameters<typeof rejectServerRequest>[1], code: number, message: string) => boolean;
  },
): ChatInboundController {
  const { plugin, thread } = context;

  return new ChatInboundController(context.state.stateStore, {
    refreshThreads: () => {
      void thread.refreshThreads();
    },
    refreshRateLimits: () => {
      void refs.serverMetadata.refreshPublishedRateLimits();
    },
    refreshSkills: (forceReload) => void thread.refreshSkills(forceReload),
    publishAppServerMetadata: thread.publishAppServerMetadataSnapshot,
    maybeNameThread: (threadId, turnId, completedSummary) => {
      refs.autoTitle.maybeAutoTitleThread(threadId, turnId, completedSummary);
    },
    notifyThreadArchived: plugin.notifyThreadArchived.bind(plugin),
    notifyThreadRenamed: plugin.notifyThreadRenamed.bind(plugin),
    recordMcpStartupStatus: (name, status, message) => {
      refs.serverDiagnostics.recordMcpStartupStatus(name, status, message);
    },
    respondToServerRequest: refs.respondToServerRequest,
    rejectServerRequest: refs.rejectServerRequest,
  });
}

type ChatConnectionControllerPorts = Pick<ChatControllerPorts, "plugin" | "state" | "liveState"> & {
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
};

export function createChatConnectionControllers(
  context: ChatConnectionControllerPorts,
  refs: {
    connection: ConnectionManager;
    serverMetadata: ChatServerMetadataActions;
    serverDiagnostics: ChatServerDiagnosticsActions;
  },
) {
  const { plugin, client, thread, status, liveState, lifecycle } = context;
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
      publishAppServerIdentity: (userAgent) => {
        plugin.publishAppServerIdentity(userAgent);
      },
      configuredCommand: () => plugin.settings.codexPath,
      refreshLiveState: liveState.refresh,
      notifyConnectionFailed: () => {
        new Notice("Codex app-server connection failed.");
      },
    }),
  };
}

type ChatReconnectControllerGroupPorts = Pick<ChatControllerPorts, "state"> & {
  client: {
    clear: () => void;
    ensureConnected: () => Promise<void>;
  };
  lifecycle: {
    invalidateConnectionWork: () => void;
    invalidateResumeWork: () => void;
    clearDeferredDiagnostics: () => void;
  };
  status: {
    set: (status: string) => void;
    addSystemMessage: (text: string) => void;
  };
  thread: {
    resumeThread: (threadId: string) => Promise<void>;
  };
};

export function createChatReconnectControllerGroup(
  context: ChatReconnectControllerGroupPorts,
  refs: {
    connection: ConnectionManager;
  },
) {
  const { client, lifecycle, status, thread } = context;

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
    ensureConnected: client.ensureConnected,
    resumeThread: thread.resumeThread,
    addSystemMessage: status.addSystemMessage,
  });

  return { reconnectActions };
}
