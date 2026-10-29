import { Notice } from "obsidian";
import { StaleConnectionError } from "../../../../app-server/connection/connection-manager";
import type { AppServerContextConnectionLease } from "../../../../app-server/connection/context-connection";
import { type ChatInboundHandler, createChatInboundHandler } from "../../app-server/inbound/handler";
import { type ChatConnectionCoordinator, createChatConnectionCoordinator } from "../../application/connection/connection-coordinator";
import { executePanelDynamicTool } from "../../application/dynamic-tools";
import type { LocalIdSource } from "../../application/local-id-source";
import { activeThreadId, type ChatConnectionPhase } from "../../application/state/model";
import type { ChatStateStore } from "../../application/state/store";
import type { AutoTitleCoordinator } from "../../application/threads/auto-title-coordinator";
import { panelThreadSubscriptions } from "../../application/threads/thread-subscriptions";
import type { ChatPanelEnvironment } from "../contracts";
import { resolveObsidianWikilinks } from "../obsidian/wikilink-resolution.obsidian";
import type { SessionThreadReadState } from "./thread-read-state";

interface SessionConnectionStatus {
  set: (statusText: string, phase?: ChatConnectionPhase) => void;
  addSystemMessage: (text: string) => void;
}

interface SessionConnectionInput {
  connection: AppServerContextConnectionLease;
  localItemIds: LocalIdSource;
  status: SessionConnectionStatus;
  autoTitleCoordinator: AutoTitleCoordinator;
  threadReadState: Pick<SessionThreadReadState, "receive">;
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

export function createSessionConnection(host: SessionConnectionHost, input: SessionConnectionInput): SessionConnection {
  const { environment, stateStore } = host;
  const { connection, localItemIds, status, autoTitleCoordinator } = input;
  let active = true;
  const updateThreadSubscriptions = () => {
    connection.updateThreadSubscriptions(panelThreadSubscriptions(stateStore.getState()));
  };
  const stopObservingSubscriptions = stateStore.subscribe(updateThreadSubscriptions);
  updateThreadSubscriptions();
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
      executeDynamicTool: (call) =>
        executePanelDynamicTool(call, {
          resolveWikilinks: (argumentsValue) => resolveObsidianWikilinks(environment.obsidian.app, argumentsValue),
        }),
    },
    localItemIds,
  );
  const invalidateConnectionScope = () => {
    inboundHandler.clearServerRequests();
  };
  const connectionCoordinator = createChatConnectionCoordinator({
    stateStore,
    invalidateThreadWork: () => {
      host.invalidateThreadWork();
    },
    resetThreadTurnPresence: (hadTurns: boolean) => {
      autoTitleCoordinator.resetThreadTurnPresence(hadTurns);
    },
    canConnect: host.canConnect,
    connection: {
      connect: () =>
        connection.connect({
          onNotification: (notification) => {
            if (!active) return;
            if (notification.method === "thread/readState/changed") input.threadReadState.receive(notification.params);
            inboundHandler.handleNotification(notification);
          },
          onServerRequest: (request, responder) => {
            if (!active) return false;
            return inboundHandler.handleServerRequest(request, responder);
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
      stopObservingSubscriptions();
      connection.updateThreadSubscriptions([]);
      connectionCoordinator.invalidate();
      inboundHandler.clearServerRequests("close");
    },
    refreshSharedThreads,
  };
}
