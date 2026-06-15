import { Notice } from "obsidian";

import type { ConnectionManager } from "../../../app-server/connection/connection-manager";
import type { SharedServerMetadata } from "../../../domain/server/metadata";
import type { Thread } from "../../../domain/threads/model";
import type { ConnectionWorkTracker } from "../../../shared/lifecycle/connection-work";
import type { ChatViewDeferredTasks } from "../application/lifecycle";
import { ChatConnectionController, handleChatConnectionExit } from "../application/connection/connection-controller";
import { createChatServerDiagnosticsActions, type ChatServerDiagnosticsActions } from "../app-server/actions/diagnostics";
import { createChatServerMetadataActions, type ChatServerMetadataActions } from "../app-server/actions/metadata";
import { createChatServerThreadActions, type ChatServerThreadActions } from "../app-server/actions/threads";
import { ChatInboundController } from "../app-server/inbound/controller";
import { rejectServerRequest, respondToServerRequest } from "../app-server/requests/responder";
import { runtimeSnapshotForChatState } from "../application/runtime/snapshot";
import type { ChatConnectionPhase } from "../application/state/root-reducer";
import type { ChatStateStore } from "../application/state/store";
import type { ThreadGoalSyncActions } from "../application/threads/goal-actions";
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

interface ChatConnectionBundleStatus {
  set: (statusText: string, phase?: ChatConnectionPhase) => void;
  addSystemMessage: (text: string) => void;
  addStructuredSystemMessage: (text: string, details: MessageStreamNoticeSection[]) => void;
}

export interface ChatConnectionBundleContext {
  connection: ConnectionManager;
  stateStore: ChatStateStore;
  vaultPath: string;
  connectionWork: ConnectionWorkTracker;
  deferredTasks: ChatViewDeferredTasks;
  threadCatalog: {
    setActiveThreads(threads: readonly Thread[]): void;
    setAppServerMetadata(metadata: SharedServerMetadata): void;
    fetchActiveThreads(fetchThreads: () => Promise<readonly Thread[]>): Promise<readonly Thread[]>;
    archiveThreadInCatalog(threadId: string): void;
    renameThreadInCatalog(threadId: string, name: string | null): void;
  };
  goalSync: ThreadGoalSyncActions;
  autoTitle: AutoTitleController;
  status: ChatConnectionBundleStatus;
  invalidateResumeWork: () => void;
  refreshTabHeader: () => void;
  refreshLiveState: () => void;
  deferLiveStateRefresh: () => void;
  configuredCommand: () => string;
}

export function createChatConnectionBundle(context: ChatConnectionBundleContext): ChatConnectionBundle {
  const { connection, stateStore, vaultPath, connectionWork, deferredTasks, threadCatalog, goalSync, autoTitle, status } = context;
  const currentClient = () => connection.currentClient();
  const serverMetadata = createChatServerMetadataActions({
    stateStore,
    vaultPath,
    currentClient,
    setAppServerMetadata: (metadata) => {
      threadCatalog.setAppServerMetadata(metadata);
    },
  });
  const serverDiagnostics = createChatServerDiagnosticsActions({
    stateStore,
    vaultPath,
    currentClient,
    setAppServerMetadata: (metadata) => {
      threadCatalog.setAppServerMetadata(metadata);
    },
    serverMetadataSnapshot: () => serverMetadata.serverMetadataSnapshot(),
  });
  const serverThreads = createChatServerThreadActions({
    stateStore,
    vaultPath,
    currentClient,
    runtimeSnapshotForState: runtimeSnapshotForChatState,
    publishThreadList: (threads) => {
      threadCatalog.setActiveThreads(threads);
    },
    syncThreadGoal: (threadId) => {
      void goalSync.syncThreadGoal(threadId);
    },
  });
  const loadSharedThreadList = async (): Promise<void> => {
    const threads = await threadCatalog.fetchActiveThreads(() => serverThreads.loadThreadList());
    serverThreads.applyThreadList(threads);
  };
  const serverRequestHost = {
    currentClient,
  };
  const inboundController = new ChatInboundController(stateStore, {
    fetchActiveThreads: () => {
      void loadSharedThreadList();
    },
    refreshRateLimits: () => {
      void serverMetadata.refreshPublishedRateLimits();
    },
    refreshSkills: (forceReload) => void serverMetadata.refreshPublishedSkills(forceReload),
    setAppServerMetadata: () => {
      serverMetadata.setAppServerMetadataSnapshot();
    },
    maybeNameThread: (threadId, turnId, completedSummary) => {
      autoTitle.maybeAutoTitleThread(threadId, turnId, completedSummary);
    },
    applyThreadArchived: (threadId) => {
      threadCatalog.archiveThreadInCatalog(threadId);
    },
    applyThreadRenamed: (threadId, name) => {
      threadCatalog.renameThreadInCatalog(threadId, name);
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
    loadSharedThreadList,
    scheduleDeferredDiagnostics: () => {
      deferredTasks.scheduleDiagnostics(() => {
        if (connection.isConnected()) {
          void serverDiagnostics.refreshPublishedDiagnosticProbes({ appServerMetadataSnapshot: true });
        }
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
