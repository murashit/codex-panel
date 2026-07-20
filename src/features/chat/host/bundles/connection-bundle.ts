import { Notice } from "obsidian";

import type { AppServerClient, AppServerServerRequestResponder } from "../../../../app-server/connection/client";
import { type ConnectionManager, StaleConnectionError } from "../../../../app-server/connection/connection-manager";
import type { SharedServerMetadataResource } from "../../../../domain/server/metadata";
import { isStaleExecutionRuntimeError } from "../../../../shared/runtime/execution-runtime-lifetime";
import { type ChatInboundHandler, createChatInboundHandler } from "../../app-server/inbound/handler";
import { type ChatConnectionActions, createChatConnectionActions } from "../../application/connection/connection-actions";
import type { ServerDiagnosticsTransport } from "../../application/connection/metadata-transport";
import { createServerDiagnosticsActions } from "../../application/connection/server-diagnostics-actions";
import { createServerMetadataActions } from "../../application/connection/server-metadata-actions";
import type { LocalIdSource } from "../../application/local-id-source";
import type { ChatConnectionPhase } from "../../application/state/root-reducer";
import type { ChatStateStore } from "../../application/state/store";
import type { AutoTitleCoordinator } from "../../application/threads/auto-title-coordinator";
import type { ChatPanelEnvironment } from "../contracts";
import type { ChatViewDeferredTasks } from "../session/deferred-work";

type RespondRequestId = Parameters<AppServerClient["respondToServerRequest"]>[0];
type RejectRequestId = Parameters<AppServerClient["rejectServerRequest"]>[0];

interface ChatPanelConnectionStatus {
  set: (statusText: string, phase?: ChatConnectionPhase) => void;
  addSystemMessage: (text: string) => void;
}

interface ChatPanelConnectionBundleInput {
  connection: ConnectionManager;
  diagnosticsTransport: ServerDiagnosticsTransport;
  localItemIds: LocalIdSource;
  status: ChatPanelConnectionStatus;
  autoTitleCoordinator: AutoTitleCoordinator;
}

interface ChatPanelConnectionBundleHost {
  environment: ChatPanelEnvironment;
  stateStore: ChatStateStore;
  canConnect: () => boolean;
  deferredTasks: ChatViewDeferredTasks;
  invalidateThreadWork: () => void;
  refreshTabHeader: () => void;
}

export interface ChatPanelConnectionBundle {
  connection: {
    manager: ConnectionManager;
    actions: ChatConnectionActions;
  };
  inboundHandler: ChatInboundHandler;
  sharedStateActions: {
    applyAppServerMetadataResource: (resource: SharedServerMetadataResource) => void;
  };
  invalidateConnectionScope: () => void;
  refreshSharedThreads: () => Promise<void>;
}

interface DeferredDiagnosticsRefreshHost {
  scheduleDiagnostics(callback: () => void): void;
  isConnected(): boolean;
  refreshServerDiagnostics(options: { appServerMetadataSnapshot: true }): Promise<void>;
  addSystemMessage(text: string): void;
}

function scheduleDeferredDiagnosticsRefresh(host: DeferredDiagnosticsRefreshHost): void {
  host.scheduleDiagnostics(() => {
    if (!host.isConnected()) return;
    void host.refreshServerDiagnostics({ appServerMetadataSnapshot: true }).catch((error: unknown) => {
      host.addSystemMessage(error instanceof Error ? error.message : String(error));
    });
  });
}

interface ServerRequestResponderRegistry {
  remember(requestId: RespondRequestId, responder: AppServerServerRequestResponder): void;
  respond(requestId: RespondRequestId, result: unknown): boolean;
  reject(requestId: RejectRequestId, code: number, message: string): boolean;
  clear(): void;
}

function createServerRequestResponderRegistry(): ServerRequestResponderRegistry {
  const responders = new Map<RespondRequestId, AppServerServerRequestResponder>();
  const take = (requestId: RespondRequestId): AppServerServerRequestResponder | null => {
    const responder = responders.get(requestId) ?? null;
    responders.delete(requestId);
    return responder;
  };
  return {
    remember: (requestId, responder) => {
      responders.set(requestId, responder);
    },
    respond: (requestId, result) => {
      const responder = take(requestId);
      if (!responder) return false;
      try {
        responder.respond(result);
        return true;
      } catch {
        return false;
      }
    },
    reject: (requestId, code, message) => {
      const responder = take(requestId);
      if (!responder) return false;
      try {
        responder.reject(code, message);
        return true;
      } catch {
        return false;
      }
    },
    clear: () => {
      responders.clear();
    },
  };
}

export function createConnectionBundle(
  host: ChatPanelConnectionBundleHost,
  input: ChatPanelConnectionBundleInput,
): ChatPanelConnectionBundle {
  const { environment, stateStore } = host;
  const { connection, diagnosticsTransport, localItemIds, status, autoTitleCoordinator } = input;
  const serverRequestResponders = createServerRequestResponderRegistry();
  const serverMetadata = createServerMetadataActions({
    stateStore,
    appServerMetadataSnapshot: () => environment.plugin.appServerQueries.appServerMetadataSnapshot(),
    refreshAppServerMetadata: () => environment.plugin.appServerQueries.refreshAppServerMetadata(),
    refreshSkills: () => environment.plugin.appServerQueries.refreshSkills(),
    refreshRateLimits: () => environment.plugin.appServerQueries.refreshRateLimits(),
    isStaleRuntimeError: isStaleExecutionRuntimeError,
  });
  const serverDiagnostics = createServerDiagnosticsActions({
    stateStore,
    diagnosticsTransport,
    appServerMetadataSnapshot: () => environment.plugin.appServerQueries.appServerMetadataSnapshot(),
  });
  const refreshSharedThreads = async (): Promise<void> => {
    await environment.plugin.threadCatalog.refreshActive();
  };
  const inboundHandler = createChatInboundHandler(
    stateStore,
    {
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
      maybeNameThread: (threadId, turnId, completedTurnTranscriptSummary) => {
        autoTitleCoordinator.maybeAutoTitleThread(threadId, turnId, completedTurnTranscriptSummary);
      },
      applyThreadCatalogEvent: (event) => {
        environment.plugin.threadCatalog.apply(event);
      },
      respondToServerRequest: (requestId, result) => serverRequestResponders.respond(requestId, result),
      rejectServerRequest: (requestId, code, message) => serverRequestResponders.reject(requestId, code, message),
    },
    localItemIds,
  );
  const connectionExitHost = {
    stateStore,
    invalidateThreadWork: () => {
      host.invalidateThreadWork();
    },
    setStatus: status.set,
    resetThreadTurnPresence: (hadTurns: boolean) => {
      autoTitleCoordinator.resetThreadTurnPresence(hadTurns);
    },
  };
  const connectionActions = createChatConnectionActions({
    ...connectionExitHost,
    canConnect: host.canConnect,
    connection: {
      connect: () =>
        connection.connect({
          onNotification: (notification) => {
            inboundHandler.handleNotification(notification);
          },
          onServerRequest: (request, responder) => {
            serverRequestResponders.remember(request.id, responder);
            inboundHandler.handleServerRequest(request);
          },
          onLog: (message) => {
            inboundHandler.handleAppServerLog(message);
          },
          onExit: () => {
            serverRequestResponders.clear();
            serverDiagnostics.invalidate();
            connectionActions.handleExit();
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
      scheduleDeferredDiagnosticsRefresh({
        scheduleDiagnostics: (callback) => {
          host.deferredTasks.scheduleDiagnostics(callback);
        },
        isConnected: () => connection.isConnected(),
        refreshServerDiagnostics: (options) => serverDiagnostics.refreshServerDiagnostics(options),
        addSystemMessage: (text) => {
          status.addSystemMessage(text);
        },
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
    configuredCommand: () => environment.plugin.appServerContext.codexPath,
    isStaleConnectionError: (error) => error instanceof StaleConnectionError,
    isStaleRuntimeError: isStaleExecutionRuntimeError,
    notifyConnectionFailed: () => {
      new Notice("Codex app-server connection failed.");
    },
  });

  return {
    connection: {
      manager: connection,
      actions: connectionActions,
    },
    inboundHandler,
    sharedStateActions: {
      applyAppServerMetadataResource: (resource) => {
        serverMetadata.applyAppServerMetadataResource(resource);
      },
    },
    invalidateConnectionScope: () => {
      serverRequestResponders.clear();
      serverDiagnostics.invalidate();
    },
    refreshSharedThreads,
  };
}
