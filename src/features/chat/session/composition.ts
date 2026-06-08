import { Notice } from "obsidian";

import type { ConnectionManager } from "../../../app-server/connection-manager";
import { createChatAppServerDiagnosticsActions, type ChatAppServerDiagnosticsActions } from "../app-server/diagnostics-actions";
import { createChatAppServerMetadataActions, type ChatAppServerMetadataActions } from "../app-server/metadata-actions";
import { createChatAppServerThreadActions } from "../app-server/thread-actions";
import { ChatConnectionController } from "./connection-controller";
import { createChatReconnectActions } from "./reconnect-actions";
import type { ServerRequestActions } from "../requests/server-request-actions";
import type { ChatThreadGoalActions } from "../threads/thread-goal-actions";
import type { ThreadRenameController } from "../threads/thread-rename-controller";
import { ChatInboundController } from "../inbound/controller";
import type { ChatPanelContext } from "../panel/context";

export function createChatAppServerControllers(
  context: ChatPanelContext,
  refs: {
    connection: ConnectionManager;
    goals: ChatThreadGoalActions;
  },
) {
  const { plugin, runtime } = context;
  const stateStore = context.state.stateStore;
  const appServerBaseHost = {
    stateStore,
    vaultPath: plugin.vaultPath,
    currentClient: () => refs.connection.currentClient(),
  };
  const appServerMetadata = createChatAppServerMetadataActions({
    ...appServerBaseHost,
    publishAppServerMetadata: (metadata) => {
      plugin.publishAppServerMetadata(metadata);
    },
  });
  const appServerDiagnostics = createChatAppServerDiagnosticsActions({
    ...appServerBaseHost,
    publishAppServerMetadata: (metadata) => {
      plugin.publishAppServerMetadata(metadata);
    },
    appServerMetadataSnapshot: () => appServerMetadata.appServerMetadataSnapshot(),
  });
  const appServerThreads = createChatAppServerThreadActions({
    ...appServerBaseHost,
    runtimeSnapshot: runtime.runtimeSnapshot,
    publishThreadList: (threads) => {
      plugin.applyThreadListSnapshot(threads);
    },
    syncThreadGoal: (threadId) => {
      void refs.goals.syncThreadGoal(threadId);
    },
  });

  return { appServerThreads, appServerMetadata, appServerDiagnostics };
}

export function createChatInboundController(
  context: ChatPanelContext,
  refs: {
    appServerMetadata: ChatAppServerMetadataActions;
    appServerDiagnostics: ChatAppServerDiagnosticsActions;
    threadRename: ThreadRenameController;
    serverRequestResponder: ServerRequestActions;
  },
): ChatInboundController {
  const { plugin, thread, render } = context;

  return new ChatInboundController(context.state.stateStore, {
    refreshThreads: () => {
      void thread.refreshThreads();
    },
    refreshRateLimits: () => {
      void refs.appServerMetadata.refreshPublishedRateLimits();
    },
    refreshSkills: (forceReload) => void thread.refreshSkills(forceReload),
    publishAppServerMetadata: thread.publishAppServerMetadataSnapshot,
    maybeNameThread: (threadId, turn) => {
      refs.threadRename.maybeAutoNameThread(threadId, turn);
    },
    notifyThreadArchived: plugin.notifyThreadArchived.bind(plugin),
    notifyThreadRenamed: plugin.notifyThreadRenamed.bind(plugin),
    recordMcpStartupStatus: (name, status, message) => {
      refs.appServerDiagnostics.recordMcpStartupStatus(name, status, message);
      render.schedule();
    },
    respondToServerRequest: (requestId, result) => refs.serverRequestResponder.respond(requestId, result),
    rejectServerRequest: (requestId, code, message) => refs.serverRequestResponder.reject(requestId, code, message),
  });
}

export function createChatConnectionControllers(
  context: ChatPanelContext,
  refs: {
    connection: ConnectionManager;
    appServerMetadata: ChatAppServerMetadataActions;
    appServerDiagnostics: ChatAppServerDiagnosticsActions;
  },
) {
  const { plugin, client, thread, status, liveState, render, lifecycle } = context;
  const { connectionWork } = lifecycle;

  return {
    connectionController: new ChatConnectionController({
      stateStore: context.state.stateStore,
      connection: refs.connection,
      connectionWork,
      metadata: {
        refreshPublishedAppServerMetadata: () => refs.appServerMetadata.refreshPublishedAppServerMetadata(),
        refreshPublishedSkills: (forceReload) => refs.appServerMetadata.refreshPublishedSkills(forceReload),
      },
      diagnostics: {
        refreshPublishedCapabilityDiagnostics: () => refs.appServerDiagnostics.refreshPublishedCapabilityDiagnostics(),
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
      configuredCommand: () => plugin.settings.codexPath,
      refreshLiveState: liveState.refresh,
      render: render.now,
      scheduleRender: render.schedule,
      notifyConnectionFailed: () => {
        new Notice("Codex app-server connection failed.");
      },
    }),
  };
}

export function createChatReconnectControllerGroup(
  context: ChatPanelContext,
  refs: {
    connection: ConnectionManager;
  },
) {
  const { client, lifecycle, render, status, thread } = context;

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
    render: render.now,
    ensureConnected: client.ensureConnected,
    resumeThread: thread.resumeThread,
    addSystemMessage: status.addSystemMessage,
  });

  return { reconnectActions };
}
