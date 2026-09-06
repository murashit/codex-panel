import { Notice } from "obsidian";

import type { AppServerClient, AppServerServerRequestResponder } from "../../../../app-server/connection/client";
import { StaleConnectionError } from "../../../../app-server/connection/connection-manager";
import type { AppServerContextConnectionLease } from "../../../../app-server/connection/context-connection";
import { type ChatInboundHandler, createChatInboundHandler } from "../../app-server/inbound/handler";
import { type ChatConnectionCoordinator, createChatConnectionCoordinator } from "../../application/connection/connection-coordinator";
import { executePanelDynamicTool } from "../../application/dynamic-tools";
import type { LocalIdSource } from "../../application/local-id-source";
import { activeThreadId, type ChatConnectionPhase } from "../../application/state/model";
import type { ChatStateStore } from "../../application/state/store";
import type { AutoTitleCoordinator } from "../../application/threads/auto-title-coordinator";
import type { ChatPanelEnvironment } from "../contracts";
import { resolveObsidianWikilinks } from "../obsidian/wikilink-resolution.obsidian";

type RespondRequestId = Parameters<AppServerClient["respondToServerRequest"]>[0];

interface SessionConnectionStatus {
  set: (statusText: string, phase?: ChatConnectionPhase) => void;
  addSystemMessage: (text: string) => void;
}

interface SessionConnectionInput {
  connection: AppServerContextConnectionLease;
  localItemIds: LocalIdSource;
  status: SessionConnectionStatus;
  autoTitleCoordinator: AutoTitleCoordinator;
}

interface SessionConnectionHost {
  environment: {
    obsidian: Pick<ChatPanelEnvironment["obsidian"], "app">;
    plugin: {
      appServerContext: ChatPanelEnvironment["plugin"]["appServerContext"];
      appServerQueries: Pick<ChatPanelEnvironment["plugin"]["appServerQueries"], "ensureAppServerMetadata" | "refreshAppServerMetadata">;
      toolInventoryQueries: Pick<ChatPanelEnvironment["plugin"]["toolInventoryQueries"], "refresh">;
      threadCatalog: Pick<ChatPanelEnvironment["plugin"]["threadCatalog"], "fetchActiveThreads" | "refreshActiveThreads">;
    };
  };
  stateStore: ChatStateStore;
  canConnect: () => boolean;
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
  const { connection, localItemIds, status, autoTitleCoordinator } = input;
  let active = true;
  const serverRequestResponders = createServerRequestResponderRegistry();
  const refreshSharedThreads = async (): Promise<void> => {
    await environment.plugin.threadCatalog.refreshActiveThreads();
  };
  const ensureSharedThreads = async (): Promise<void> => {
    await environment.plugin.threadCatalog.fetchActiveThreads();
  };
  const inboundHandler = createChatInboundHandler(
    stateStore,
    {
      maybeNameThread: (threadId, turnId, completedTurnTranscriptSummary) => {
        autoTitleCoordinator.maybeAutoTitleThread(threadId, turnId, completedTurnTranscriptSummary);
      },
      respondToServerRequest: (requestId, result) => serverRequestResponders.respond(requestId, result),
      rejectServerRequest: (requestId, code, message) => serverRequestResponders.reject(requestId, code, message),
      executeDynamicTool: async (call) =>
        executePanelDynamicTool(call, {
          resolveWikilinks: (argumentsValue) => resolveObsidianWikilinks(environment.obsidian.app, argumentsValue),
        }),
    },
    localItemIds,
  );
  const invalidateConnectionScope = () => {
    inboundHandler.clearServerRequests();
    serverRequestResponders.rejectAll(-32000, "Codex Panel disconnected before the request was answered.");
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
    ensureAppServerMetadata: () => environment.plugin.appServerQueries.ensureAppServerMetadata(),
    refreshAppServerMetadata: () => environment.plugin.appServerQueries.refreshAppServerMetadata(),
    refreshToolInventory: () => environment.plugin.toolInventoryQueries.refresh(activeThreadId(stateStore.getState())),
    ensureSharedThreads,
    refreshSharedThreads,
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
      connectionCoordinator.invalidate();
      invalidateConnectionScope();
    },
    refreshSharedThreads,
  };
}
