import { Notice } from "obsidian";

import type { AppServerClient, AppServerServerRequestResponder } from "../../../../app-server/connection/client";
import { StaleConnectionError } from "../../../../app-server/connection/connection-manager";
import type { AppServerContextConnectionLease } from "../../../../app-server/connection/context-connection";
import { cloneServerDiagnostics, invalidateMcpServerRuntimeDiagnostics } from "../../../../domain/server/diagnostics";
import { type ChatInboundHandler, createChatInboundHandler } from "../../app-server/inbound/handler";
import { type ChatConnectionCoordinator, createChatConnectionCoordinator } from "../../application/connection/connection-coordinator";
import { createServerDiagnosticsCoordinator } from "../../application/connection/server-diagnostics-coordinator";
import type { ServerDiagnosticsPort } from "../../application/connection/server-diagnostics-port";
import { handleAppServerResourceFact, type ServerResourceFactHost } from "../../application/connection/server-resource-facts";
import type { LocalIdSource } from "../../application/local-id-source";
import { activeThreadId, type ChatConnectionPhase } from "../../application/state/model";
import type { ChatStateStore } from "../../application/state/store";
import type { AutoTitleCoordinator } from "../../application/threads/auto-title-coordinator";
import type { ChatPanelEnvironment } from "../contracts";
import type { ChatViewDeferredTasks } from "./deferred-work";

type RespondRequestId = Parameters<AppServerClient["respondToServerRequest"]>[0];

interface SessionConnectionStatus {
  set: (statusText: string, phase?: ChatConnectionPhase) => void;
  addSystemMessage: (text: string) => void;
}

interface SessionConnectionInput {
  connection: AppServerContextConnectionLease;
  diagnosticsPort: ServerDiagnosticsPort;
  localItemIds: LocalIdSource;
  status: SessionConnectionStatus;
  autoTitleCoordinator: AutoTitleCoordinator;
}

interface SessionConnectionHost {
  environment: ChatPanelEnvironment;
  stateStore: ChatStateStore;
  canConnect: () => boolean;
  deferredTasks: ChatViewDeferredTasks;
  invalidateThreadWork: () => void;
  refreshTabHeader: () => void;
}

export interface SessionConnection {
  coordinator: ChatConnectionCoordinator;
  inboundHandler: ChatInboundHandler;
  invalidateConnectionScope: () => void;
  deactivate: () => void;
  refreshSharedThreads: () => Promise<void>;
}

function createServerRequestResponderRegistry() {
  const responders = new Map<RespondRequestId, AppServerServerRequestResponder>();
  const settle = (requestId: RespondRequestId, deliver: (responder: AppServerServerRequestResponder) => void): boolean => {
    const responder = responders.get(requestId) ?? null;
    if (!responder) return false;
    try {
      deliver(responder);
      responders.delete(requestId);
      return true;
    } catch {
      return false;
    }
  };
  return {
    remember: (requestId: RespondRequestId, responder: AppServerServerRequestResponder) => {
      responders.set(requestId, responder);
    },
    forget: (requestId: RespondRequestId) => {
      responders.delete(requestId);
    },
    respond: (requestId: RespondRequestId, result: unknown) =>
      settle(requestId, (responder) => {
        responder.respond(result);
      }),
    reject: (requestId: RespondRequestId, code: number, message: string) =>
      settle(requestId, (responder) => {
        responder.reject(code, message);
      }),
    rejectAll: (code: number, message: string) => {
      for (const requestId of responders.keys()) {
        settle(requestId, (responder) => {
          responder.reject(code, message);
        });
      }
      responders.clear();
    },
  };
}

export function createSessionConnection(host: SessionConnectionHost, input: SessionConnectionInput): SessionConnection {
  const { environment, stateStore } = host;
  const { connection, diagnosticsPort, localItemIds, status, autoTitleCoordinator } = input;
  let active = true;
  const serverRequestResponders = createServerRequestResponderRegistry();
  const serverResourceFactHost: ServerResourceFactHost = {
    stateStore,
    refreshSkills: () => environment.plugin.appServerQueries.refreshSkills(),
    refreshRateLimits: () => environment.plugin.appServerQueries.refreshRateLimits(),
  };
  const diagnosticsCoordinator = createServerDiagnosticsCoordinator({
    stateStore,
    diagnosticsPort,
  });
  let observedActiveThreadId = activeThreadId(stateStore.getState());
  const unsubscribeActiveThreadDiagnostics = stateStore.subscribe(() => {
    const nextActiveThreadId = activeThreadId(stateStore.getState());
    if (nextActiveThreadId === observedActiveThreadId) return;
    observedActiveThreadId = nextActiveThreadId;
    diagnosticsCoordinator.invalidate();
    stateStore.dispatch({
      type: "connection/diagnostics-applied",
      serverDiagnostics: invalidateMcpServerRuntimeDiagnostics(cloneServerDiagnostics(stateStore.getState().connection.serverDiagnostics)),
    });
    if (!connection.isConnected() || !host.canConnect()) return;
    void diagnosticsCoordinator.refreshServerDiagnostics().catch((error: unknown) => {
      status.addSystemMessage(error instanceof Error ? error.message : String(error));
    });
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
        void handleAppServerResourceFact(serverResourceFactHost, fact).catch((error: unknown) => {
          status.addSystemMessage(error instanceof Error ? error.message : String(error));
        });
      },
      maybeNameThread: (threadId, turnId, completedTurnTranscriptSummary) => {
        autoTitleCoordinator.maybeAutoTitleThread(threadId, turnId, completedTurnTranscriptSummary);
      },
      observeThreadGoal: (threadId) => {
        environment.plugin.threadGoalCoordinator.markAuthoritativeObservation(threadId);
      },
      respondToServerRequest: (requestId, result) => serverRequestResponders.respond(requestId, result),
      rejectServerRequest: (requestId, code, message) => serverRequestResponders.reject(requestId, code, message),
    },
    localItemIds,
  );
  const invalidateConnectionScope = () => {
    inboundHandler.clearServerRequests();
    serverRequestResponders.rejectAll(-32000, "Codex Panel disconnected before the request was answered.");
    diagnosticsCoordinator.invalidate();
  };
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
            if (!active) return;
            inboundHandler.handleNotification(notification);
          },
          onServerRequest: (request, responder) => {
            if (!active) return false;
            serverRequestResponders.remember(request.id, responder);
            const handled = inboundHandler.handleServerRequest(request);
            if (!handled) serverRequestResponders.forget(request.id);
            return handled;
          },
          onLog: (message) => {
            if (!active) return;
            inboundHandler.handleAppServerLog(message);
          },
          onExit: () => {
            if (!active) return;
            invalidateConnectionScope();
            connectionCoordinator.handleExit();
          },
        }),
      isConnected: () => connection.isConnected(),
    },
    refreshAppServerMetadata: () => environment.plugin.appServerQueries.refreshAppServerMetadata(),
    refreshServerDiagnostics: () => diagnosticsCoordinator.refreshServerDiagnostics(),
    refreshSharedThreads,
    scheduleDeferredDiagnostics: () => {
      host.deferredTasks.scheduleDiagnostics(() => {
        if (!connection.isConnected()) return;
        void diagnosticsCoordinator.refreshServerDiagnostics().catch((error: unknown) => {
          status.addSystemMessage(error instanceof Error ? error.message : String(error));
        });
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
    notifyConnectionFailed: () => {
      new Notice("Codex app-server connection failed.");
    },
  });

  return {
    coordinator: connectionCoordinator,
    inboundHandler,
    invalidateConnectionScope,
    deactivate: () => {
      active = false;
      unsubscribeActiveThreadDiagnostics();
      connectionCoordinator.invalidate();
      invalidateConnectionScope();
    },
    refreshSharedThreads,
  };
}
