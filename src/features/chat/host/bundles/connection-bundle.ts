import { Notice } from "obsidian";

import type { AppServerClient, AppServerServerRequestResponder } from "../../../../app-server/connection/client";
import { type ConnectionManager, StaleConnectionError } from "../../../../app-server/connection/connection-manager";
import { isStaleExecutionRuntimeError } from "../../../../shared/runtime/execution-runtime-lifetime";
import { type ChatInboundHandler, createChatInboundHandler } from "../../app-server/inbound/handler";
import { type ChatConnectionCoordinator, createChatConnectionCoordinator } from "../../application/connection/connection-coordinator";
import { createServerDiagnosticsCoordinator } from "../../application/connection/server-diagnostics-coordinator";
import type { ServerDiagnosticsPort } from "../../application/connection/server-diagnostics-port";
import { createServerMetadataEffects } from "../../application/connection/server-metadata-effects";
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
  diagnosticsPort: ServerDiagnosticsPort;
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
    coordinator: ChatConnectionCoordinator;
  };
  inboundHandler: ChatInboundHandler;
  invalidateConnectionScope: () => void;
  refreshSharedThreads: () => Promise<void>;
}

interface DeferredDiagnosticsRefreshHost {
  scheduleDiagnostics(callback: () => void): void;
  isConnected(): boolean;
  refreshServerDiagnostics(): Promise<void>;
  addSystemMessage(text: string): void;
}

function scheduleDeferredDiagnosticsRefresh(host: DeferredDiagnosticsRefreshHost): void {
  host.scheduleDiagnostics(() => {
    if (!host.isConnected()) return;
    void host.refreshServerDiagnostics().catch((error: unknown) => {
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
  return {
    remember: (requestId, responder) => {
      responders.set(requestId, responder);
    },
    respond: (requestId, result) => {
      const responder = responders.get(requestId) ?? null;
      if (!responder) return false;
      try {
        responder.respond(result);
        responders.delete(requestId);
        return true;
      } catch {
        return false;
      }
    },
    reject: (requestId, code, message) => {
      const responder = responders.get(requestId) ?? null;
      if (!responder) return false;
      try {
        responder.reject(code, message);
        responders.delete(requestId);
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
  const { connection, diagnosticsPort, localItemIds, status, autoTitleCoordinator } = input;
  const serverRequestResponders = createServerRequestResponderRegistry();
  const serverMetadataEffects = createServerMetadataEffects({
    stateStore,
    refreshAppServerMetadata: () => environment.plugin.appServerQueries.refreshAppServerMetadata(),
    refreshSkills: () => environment.plugin.appServerQueries.refreshSkills(),
    refreshRateLimits: () => environment.plugin.appServerQueries.refreshRateLimits(),
    isStaleRuntimeError: isStaleExecutionRuntimeError,
  });
  const diagnosticsCoordinator = createServerDiagnosticsCoordinator({
    stateStore,
    diagnosticsPort,
  });
  const refreshSharedThreads = async (): Promise<void> => {
    await environment.plugin.threadCatalog.refreshActiveThreads();
  };
  const inboundHandler = createChatInboundHandler(
    stateStore,
    {
      refreshServerDiagnostics: () => {
        void diagnosticsCoordinator.refreshServerDiagnostics().catch((error: unknown) => {
          status.addSystemMessage(error instanceof Error ? error.message : String(error));
        });
      },
      handleAppServerResourceFact: (fact) => {
        void serverMetadataEffects.handleAppServerResourceFact(fact).catch((error: unknown) => {
          status.addSystemMessage(error instanceof Error ? error.message : String(error));
        });
      },
      maybeNameThread: (threadId, turnId, completedTurnTranscriptSummary) => {
        autoTitleCoordinator.maybeAutoTitleThread(threadId, turnId, completedTurnTranscriptSummary);
      },
      applyThreadFact: (fact) => {
        environment.plugin.threadFacts.apply(fact);
      },
      observeThreadGoal: (threadId) => {
        environment.plugin.threadGoalCoordinator.markAuthoritativeObservation(threadId);
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
  const connectionCoordinator = createChatConnectionCoordinator({
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
            inboundHandler.clearServerRequests();
            serverRequestResponders.clear();
            diagnosticsCoordinator.invalidate();
            connectionCoordinator.handleExit();
          },
        }),
      isConnected: () => connection.isConnected(),
    },
    metadataEffects: {
      refreshAppServerMetadata: () => serverMetadataEffects.refreshAppServerMetadata(),
    },
    diagnosticsCoordinator: {
      refreshServerDiagnostics: () => diagnosticsCoordinator.refreshServerDiagnostics(),
    },
    refreshSharedThreads,
    scheduleDeferredDiagnostics: () => {
      scheduleDeferredDiagnosticsRefresh({
        scheduleDiagnostics: (callback) => {
          host.deferredTasks.scheduleDiagnostics(callback);
        },
        isConnected: () => connection.isConnected(),
        refreshServerDiagnostics: () => diagnosticsCoordinator.refreshServerDiagnostics(),
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
      coordinator: connectionCoordinator,
    },
    inboundHandler,
    invalidateConnectionScope: () => {
      inboundHandler.clearServerRequests();
      serverRequestResponders.clear();
      diagnosticsCoordinator.invalidate();
    },
    refreshSharedThreads,
  };
}
