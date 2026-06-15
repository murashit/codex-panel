import { Notice } from "obsidian";

import { ConnectionManager } from "../../../app-server/connection/connection-manager";
import type { ThreadSurfaceBroadcaster } from "../application/ports/chat-host";
import type { ChatConnectionWorkTracker, ChatViewDeferredTasks } from "../application/lifecycle";
import { ChatConnectionController, handleChatConnectionExit } from "../application/connection/connection-controller";
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
  connection: {
    manager: ConnectionManager;
    controller: ChatConnectionController;
  };
  inboundController: ChatInboundController;
  serverActions: {
    threads: ChatServerThreadActions;
    metadata: ChatServerMetadataActions;
    diagnostics: ChatServerDiagnosticsActions;
  };
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
  codexPath: () => string;
  connectionWork: ChatConnectionWorkTracker;
  deferredTasks: ChatViewDeferredTasks;
  threadSurfaces: ThreadSurfaceBroadcaster;
  refresh: ChatConnectionRefreshPorts;
  goals: GoalActions;
  autoTitle: AutoTitleController;
  status: ChatConnectionBundleStatus;
  invalidateResumeWork: () => void;
  loadSharedThreadList: () => Promise<void>;
  refreshDeferredDiagnostics: () => Promise<void>;
  refreshTabHeader: () => void;
  refreshLiveState: () => void;
  deferLiveStateRefresh: () => void;
  configuredCommand: () => string;
}

export function createChatConnectionBundle(context: ChatConnectionBundleContext): ChatConnectionBundle {
  const { stateStore, vaultPath, connectionWork, deferredTasks, threadSurfaces, refresh, goals, autoTitle, status } = context;
  const connection = new ConnectionManager(context.codexPath, vaultPath);
  const currentClient = () => connection.currentClient();
  const serverMetadata = createChatServerMetadataActions({
    stateStore,
    vaultPath,
    currentClient,
    publishAppServerMetadata: (metadata) => {
      threadSurfaces.publishAppServerMetadata(metadata);
    },
  });
  const serverDiagnostics = createChatServerDiagnosticsActions({
    stateStore,
    vaultPath,
    currentClient,
    publishAppServerMetadata: (metadata) => {
      threadSurfaces.publishAppServerMetadata(metadata);
    },
    serverMetadataSnapshot: () => serverMetadata.serverMetadataSnapshot(),
  });
  const serverThreads = createChatServerThreadActions({
    stateStore,
    vaultPath,
    currentClient,
    runtimeSnapshotForState: runtimeSnapshotForChatState,
    publishThreadList: (threads) => {
      threadSurfaces.applyThreadListSnapshot(threads);
    },
    syncThreadGoal: (threadId) => {
      void goals.syncThreadGoal(threadId);
    },
  });
  const serverRequestHost = {
    currentClient,
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
  const connectionExitHost = {
    stateStore,
    connectionWork,
    invalidateResumeWork: context.invalidateResumeWork,
    setStatus: status.set,
    resetThreadTurnPresence: (hadTurns: boolean) => {
      autoTitle.resetThreadTurnPresence(hadTurns);
    },
    refreshLiveState: context.refreshLiveState,
  };
  const connectionController = new ChatConnectionController({
    ...connectionExitHost,
    connection: {
      connect: () =>
        connection.connect({
          onNotification: (notification) => {
            inboundController.handleNotification(notification);
            context.deferLiveStateRefresh();
          },
          onServerRequest: (request) => {
            inboundController.handleServerRequest(request);
            context.deferLiveStateRefresh();
          },
          onLog: (message) => {
            inboundController.handleAppServerLog(message);
          },
          onExit: () => {
            handleChatConnectionExit(connectionExitHost);
          },
        }),
      currentClient,
      isConnected: () => connection.isConnected(),
    },
    metadata: {
      refreshPublishedAppServerMetadata: () => serverMetadata.refreshPublishedAppServerMetadata(),
      refreshPublishedSkills: (forceReload) => serverMetadata.refreshPublishedSkills(forceReload),
    },
    diagnostics: {
      refreshPublishedDiagnosticProbes: () => serverDiagnostics.refreshPublishedDiagnosticProbes(),
    },
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
    setStatus: status.set,
    addSystemMessage: status.addSystemMessage,
    configuredCommand: context.configuredCommand,
    refreshLiveState: context.refreshLiveState,
    notifyConnectionFailed: () => {
      new Notice("Codex app-server connection failed.");
    },
  });

  return {
    connection: {
      manager: connection,
      controller: connectionController,
    },
    inboundController,
    serverActions: {
      threads: serverThreads,
      metadata: serverMetadata,
      diagnostics: serverDiagnostics,
    },
  };
}
