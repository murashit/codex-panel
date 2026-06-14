import { Notice } from "obsidian";

import type { AppServerClient } from "../../../app-server/connection/client";
import type { ConnectionManager, ConnectionManagerHandlers } from "../../../app-server/connection/connection-manager";
import type { ThreadSurfaceBroadcaster } from "../application/ports/chat-host";
import type { ChatConnectionWorkTracker, ChatViewDeferredTasks } from "../application/lifecycle";
import { ChatConnectionController } from "../application/connection/connection-controller";
import { createChatServerDiagnosticsActions, type ChatServerDiagnosticsActions } from "../app-server/actions/diagnostics";
import { createChatServerMetadataActions, type ChatServerMetadataActions } from "../app-server/actions/metadata";
import { createChatServerThreadActions, type ChatServerThreadActions } from "../app-server/actions/threads";
import { ChatInboundController } from "../app-server/inbound/controller";
import { rejectServerRequest, respondToServerRequest } from "../app-server/requests/responder";
import { runtimeSnapshotForChatState } from "../application/runtime/snapshot";
import type { ChatConnectionPhase } from "../application/state/root-reducer";
import type { ChatStateStore } from "../application/state/store";
import type { GoalActions } from "../application/threads/goal-actions";
import type { AutoTitleController } from "../application/threads/auto-title-controller";
import type { MessageStreamNoticeSection } from "../domain/message-stream/items";

export interface ChatConnectionBundle {
  connectionController: ChatConnectionController;
  inboundController: ChatInboundController;
  serverActions: {
    threads: ChatServerThreadActions;
    metadata: ChatServerMetadataActions;
    diagnostics: ChatServerDiagnosticsActions;
  };
}

interface ChatConnectionClientPorts {
  currentClient: () => AppServerClient | null;
}

interface ChatConnectionRefreshPorts {
  refreshThreads: () => Promise<void>;
  refreshSkills: (forceReload?: boolean) => Promise<void>;
}

interface ChatConnectionBundleStatus {
  set: (statusText: string, phase?: ChatConnectionPhase) => void;
  addSystemMessage: (text: string) => void;
  addStructuredSystemMessage: (text: string, details: MessageStreamNoticeSection[]) => void;
}

export interface ChatConnectionBundleContext {
  stateStore: ChatStateStore;
  vaultPath: string;
  connection: ConnectionManager;
  connectionWork: ChatConnectionWorkTracker;
  deferredTasks: ChatViewDeferredTasks;
  threadSurfaces: ThreadSurfaceBroadcaster;
  client: ChatConnectionClientPorts;
  refresh: ChatConnectionRefreshPorts;
  goals: GoalActions;
  autoTitle: AutoTitleController;
  status: ChatConnectionBundleStatus;
  invalidateResumeWork: () => void;
  loadSharedThreadList: () => Promise<void>;
  refreshDeferredDiagnostics: () => Promise<void>;
  refreshTabHeader: () => void;
  refreshLiveState: () => void;
  configuredCommand: () => string;
}

export interface ChatConnectionEventTargets {
  inbound: ChatInboundController;
  connectionController: ChatConnectionController;
}

export function createChatConnectionBundle(context: ChatConnectionBundleContext): ChatConnectionBundle {
  const { stateStore, vaultPath, connection, connectionWork, deferredTasks, threadSurfaces, client, refresh, goals, autoTitle, status } =
    context;
  const serverMetadata = createChatServerMetadataActions({
    stateStore,
    vaultPath,
    currentClient: client.currentClient,
    publishAppServerMetadata: (metadata) => {
      threadSurfaces.publishAppServerMetadata(metadata);
    },
  });
  const serverDiagnostics = createChatServerDiagnosticsActions({
    stateStore,
    vaultPath,
    currentClient: client.currentClient,
    publishAppServerMetadata: (metadata) => {
      threadSurfaces.publishAppServerMetadata(metadata);
    },
    serverMetadataSnapshot: () => serverMetadata.serverMetadataSnapshot(),
  });
  const serverThreads = createChatServerThreadActions({
    stateStore,
    vaultPath,
    currentClient: client.currentClient,
    runtimeSnapshotForState: runtimeSnapshotForChatState,
    publishThreadList: (threads) => {
      threadSurfaces.applyThreadListSnapshot(threads);
    },
    syncThreadGoal: (threadId) => {
      void goals.syncThreadGoal(threadId);
    },
  });
  const serverRequestHost = {
    currentClient: client.currentClient,
  };
  const inboundController = new ChatInboundController(stateStore, {
    refreshThreads: () => {
      void refresh.refreshThreads();
    },
    refreshRateLimits: () => {
      void serverMetadata.refreshPublishedRateLimits();
    },
    refreshSkills: (forceReload) => void refresh.refreshSkills(forceReload),
    publishAppServerMetadata: () => {
      serverMetadata.publishAppServerMetadataSnapshot();
    },
    maybeNameThread: (threadId, turnId, completedSummary) => {
      autoTitle.maybeAutoTitleThread(threadId, turnId, completedSummary);
    },
    notifyThreadArchived: (threadId) => {
      threadSurfaces.notifyThreadArchived(threadId);
    },
    notifyThreadRenamed: (threadId, name) => {
      threadSurfaces.notifyThreadRenamed(threadId, name);
    },
    recordMcpStartupStatus: (name, mcpStatus, message) => {
      serverDiagnostics.recordMcpStartupStatus(name, mcpStatus, message);
    },
    respondToServerRequest: (requestId, result) => respondToServerRequest(serverRequestHost, requestId, result),
    rejectServerRequest: (requestId, code, message) => rejectServerRequest(serverRequestHost, requestId, code, message),
  });
  const connectionController = new ChatConnectionController({
    stateStore,
    connection,
    connectionWork,
    metadata: {
      refreshPublishedAppServerMetadata: () => serverMetadata.refreshPublishedAppServerMetadata(),
      refreshPublishedSkills: (forceReload) => serverMetadata.refreshPublishedSkills(forceReload),
    },
    diagnostics: {
      refreshPublishedDiagnosticProbes: () => serverDiagnostics.refreshPublishedDiagnosticProbes(),
    },
    invalidateResumeWork: context.invalidateResumeWork,
    loadSharedThreadList: context.loadSharedThreadList,
    scheduleDeferredDiagnostics: () => {
      deferredTasks.scheduleDiagnostics(() => {
        void context.refreshDeferredDiagnostics();
      });
    },
    clearDeferredDiagnostics: () => {
      deferredTasks.clearDiagnostics();
    },
    refreshTabHeader: context.refreshTabHeader,
    resetThreadTurnPresence: (hadTurns) => {
      autoTitle.resetThreadTurnPresence(hadTurns);
    },
    setStatus: status.set,
    addSystemMessage: status.addSystemMessage,
    configuredCommand: context.configuredCommand,
    refreshLiveState: context.refreshLiveState,
    notifyConnectionFailed: () => {
      new Notice("Codex app-server connection failed.");
    },
  });

  return {
    connectionController,
    inboundController,
    serverActions: {
      threads: serverThreads,
      metadata: serverMetadata,
      diagnostics: serverDiagnostics,
    },
  };
}

export function createChatConnectionEventRouter(callbacks: { deferLiveStateRefresh: () => void }): {
  handlers: ConnectionManagerHandlers;
  attach: (targets: ChatConnectionEventTargets) => void;
} {
  let targets: ChatConnectionEventTargets | null = null;
  const currentTargets = () => {
    if (!targets) throw new Error("Codex app-server connection event received before chat session parts were initialized.");
    return targets;
  };
  return {
    handlers: {
      onNotification: (notification) => {
        currentTargets().inbound.handleNotification(notification);
        callbacks.deferLiveStateRefresh();
      },
      onServerRequest: (request) => {
        currentTargets().inbound.handleServerRequest(request);
        callbacks.deferLiveStateRefresh();
      },
      onLog: (message) => {
        currentTargets().inbound.handleAppServerLog(message);
      },
      onExit: () => {
        currentTargets().connectionController.handleExit();
      },
    },
    attach: (nextTargets) => {
      targets = nextTargets;
    },
  };
}
