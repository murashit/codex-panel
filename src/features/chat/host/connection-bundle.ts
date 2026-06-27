import { Notice } from "obsidian";

import type { AppServerClient } from "../../../app-server/connection/client";
import { type ConnectionManager, StaleConnectionError } from "../../../app-server/connection/connection-manager";
import { isStaleAppServerSharedQueryContextError } from "../../../app-server/query/shared-queries";
import type { LocalIdSource } from "../../../shared/id/local-id";
import type { ConnectionWorkTracker } from "../../../shared/lifecycle/connection-work";
import { type ChatServerDiagnosticsActions, createChatServerDiagnosticsActions } from "../app-server/actions/diagnostics";
import { type ChatServerMetadataActions, createChatServerMetadataActions } from "../app-server/actions/metadata";
import { type ChatServerThreadActions, createChatServerThreadActions } from "../app-server/actions/threads";
import { type ChatInboundHandler, createChatInboundHandler } from "../app-server/inbound/handler";
import {
  type ChatConnectionController,
  createChatConnectionController,
  handleChatConnectionExit,
} from "../application/connection/connection-controller";
import { runtimeSnapshotForChatState } from "../application/runtime/snapshot";
import type { ChatConnectionPhase } from "../application/state/root-reducer";
import type { ChatStateStore } from "../application/state/store";
import type { AutoTitleCoordinator } from "../application/threads/auto-title-coordinator";
import type { createThreadGoalSyncActions } from "../application/threads/goal-actions";
import type { ChatPanelEnvironment } from "./contracts";
import type { ChatViewDeferredTasks } from "./deferred-work";

export type CurrentAppServerClient = () => AppServerClient | null;

type RespondRequestId = Parameters<AppServerClient["respondToServerRequest"]>[0];
type RejectRequestId = Parameters<AppServerClient["rejectServerRequest"]>[0];
type ChatPanelGoalSyncActions = ReturnType<typeof createThreadGoalSyncActions>;

interface ChatPanelConnectionStatus {
  set: (statusText: string, phase?: ChatConnectionPhase) => void;
  addSystemMessage: (text: string) => void;
}

interface ChatPanelConnectionBundleInput {
  connection: ConnectionManager;
  currentClient: CurrentAppServerClient;
  localItemIds: LocalIdSource;
  status: ChatPanelConnectionStatus;
  goalSync: ChatPanelGoalSyncActions;
  autoTitleCoordinator: AutoTitleCoordinator;
}

interface ChatPanelConnectionBundleHost {
  environment: ChatPanelEnvironment;
  stateStore: ChatStateStore;
  connectionWork: ConnectionWorkTracker;
  deferredTasks: ChatViewDeferredTasks;
  invalidateThreadWork: () => void;
  deferLiveStateRefresh: () => void;
  refreshTabHeader: () => void;
  refreshLiveState: () => void;
}

export interface ChatPanelConnectionBundle {
  connection: {
    manager: ConnectionManager;
    controller: ChatConnectionController;
  };
  inboundHandler: ChatInboundHandler;
  serverActions: {
    threads: ChatServerThreadActions;
    metadata: ChatServerMetadataActions;
    diagnostics: ChatServerDiagnosticsActions;
  };
  refreshSharedThreads: () => Promise<void>;
}

function respondToCurrentServerRequest(currentClient: CurrentAppServerClient, requestId: RespondRequestId, result: unknown): boolean {
  try {
    const client = currentClient();
    client?.respondToServerRequest(requestId, result);
    return Boolean(client);
  } catch {
    return false;
  }
}

function rejectCurrentServerRequest(
  currentClient: CurrentAppServerClient,
  requestId: RejectRequestId,
  code: number,
  message: string,
): boolean {
  try {
    const client = currentClient();
    client?.rejectServerRequest(requestId, code, message);
    return Boolean(client);
  } catch {
    return false;
  }
}

export function createConnectionBundle(
  host: ChatPanelConnectionBundleHost,
  input: ChatPanelConnectionBundleInput,
): ChatPanelConnectionBundle {
  const { environment, stateStore } = host;
  const { connection, currentClient, localItemIds, status, goalSync, autoTitleCoordinator } = input;
  const serverMetadata = createChatServerMetadataActions({
    stateStore,
    vaultPath: environment.plugin.settingsRef.vaultPath,
    currentClient,
    updateAppServerMetadata: (updater) => environment.plugin.appServerQueries.updateAppServerMetadata(updater),
    appServerMetadataSnapshot: () => environment.plugin.appServerQueries.appServerMetadataSnapshot(),
    refreshAppServerMetadata: (options) => environment.plugin.appServerQueries.refreshAppServerMetadata(options),
  });
  const serverDiagnostics = createChatServerDiagnosticsActions({
    stateStore,
    vaultPath: environment.plugin.settingsRef.vaultPath,
    currentClient,
    updateAppServerMetadata: (updater) => environment.plugin.appServerQueries.updateAppServerMetadata(updater),
    appServerMetadataSnapshot: () => environment.plugin.appServerQueries.appServerMetadataSnapshot(),
  });
  const serverThreads = createChatServerThreadActions({
    stateStore,
    vaultPath: environment.plugin.settingsRef.vaultPath,
    currentClient,
    runtimeSnapshotForState: runtimeSnapshotForChatState,
    applyThreadCatalogEvent: (event) => {
      environment.plugin.threadCatalog.apply(event);
    },
    syncThreadGoal: (threadId) => {
      void goalSync.syncThreadGoal(threadId);
    },
  });
  const refreshSharedThreads = async (): Promise<void> => {
    const threads = await environment.plugin.threadCatalog.refreshActive();
    serverThreads.applyThreadList(threads);
  };
  const refreshSharedThreadsQuietly = (): void => {
    void refreshSharedThreads().catch((error: unknown) => {
      if (isStaleAppServerSharedQueryContextError(error)) return;
      status.addSystemMessage(error instanceof Error ? error.message : String(error));
    });
  };
  const inboundHandler = createChatInboundHandler(
    stateStore,
    {
      refreshActiveThreads: () => {
        refreshSharedThreadsQuietly();
      },
      refreshServerDiagnostics: (options) => {
        void serverDiagnostics.refreshServerDiagnostics(options).catch((error: unknown) => {
          status.addSystemMessage(error instanceof Error ? error.message : String(error));
        });
      },
      applyAppServerResourceEvent: (event) => {
        void serverMetadata.applyAppServerResourceEvent(event).catch((error: unknown) => {
          status.addSystemMessage(error instanceof Error ? error.message : String(error));
        });
      },
      maybeNameThread: (threadId, turnId, completedSummary) => {
        autoTitleCoordinator.maybeAutoTitleThread(threadId, turnId, completedSummary);
      },
      applyThreadCatalogEvent: (event) => {
        environment.plugin.threadCatalog.apply(event);
      },
      respondToServerRequest: (requestId, result) => respondToCurrentServerRequest(currentClient, requestId, result),
      rejectServerRequest: (requestId, code, message) => rejectCurrentServerRequest(currentClient, requestId, code, message),
    },
    localItemIds,
  );
  const connectionExitHost = {
    stateStore,
    connectionWork: host.connectionWork,
    invalidateThreadWork: () => {
      host.invalidateThreadWork();
    },
    setStatus: status.set,
    resetThreadTurnPresence: (hadTurns: boolean) => {
      autoTitleCoordinator.resetThreadTurnPresence(hadTurns);
    },
    refreshLiveState: () => {
      host.refreshLiveState();
    },
  };
  const connectionController = createChatConnectionController({
    ...connectionExitHost,
    connection: {
      connect: () =>
        connection.connect({
          onNotification: (notification) => {
            inboundHandler.handleNotification(notification);
            host.deferLiveStateRefresh();
          },
          onServerRequest: (request) => {
            inboundHandler.handleServerRequest(request);
            host.deferLiveStateRefresh();
          },
          onLog: (message) => {
            inboundHandler.handleAppServerLog(message);
          },
          onExit: () => {
            handleChatConnectionExit(connectionExitHost);
          },
        }),
      isConnected: () => connection.isConnected(),
    },
    metadata: {
      refreshAppServerMetadata: () => serverMetadata.refreshAppServerMetadata(),
    },
    diagnostics: {
      refreshServerDiagnostics: (options) => serverDiagnostics.refreshServerDiagnostics(options),
    },
    refreshSharedThreads,
    scheduleDeferredDiagnostics: () => {
      host.deferredTasks.scheduleDiagnostics(() => {
        if (connection.isConnected()) {
          void serverDiagnostics.refreshServerDiagnostics({ appServerMetadataSnapshot: true });
        }
      });
    },
    clearDeferredDiagnostics: () => {
      host.deferredTasks.clearDiagnostics();
    },
    refreshTabHeader: () => {
      host.refreshTabHeader();
    },
    setStatus: status.set,
    addSystemMessage: status.addSystemMessage,
    configuredCommand: () => environment.plugin.settingsRef.settings.codexPath(),
    refreshLiveState: () => {
      host.refreshLiveState();
    },
    isStaleConnectionError: (error) => error instanceof StaleConnectionError,
    isStaleSharedQueryError: isStaleAppServerSharedQueryContextError,
    notifyConnectionFailed: () => {
      new Notice("Codex app-server connection failed.");
    },
  });

  return {
    connection: {
      manager: connection,
      controller: connectionController,
    },
    inboundHandler,
    serverActions: {
      threads: serverThreads,
      metadata: serverMetadata,
      diagnostics: serverDiagnostics,
    },
    refreshSharedThreads,
  };
}
