import { Notice } from "obsidian";

import type { ConnectionManager } from "../../../app-server/connection-manager";
import { createChatServerDiagnosticsActions, type ChatServerDiagnosticsActions } from "../server-actions/diagnostics-actions";
import { createChatServerMetadataActions, type ChatServerMetadataActions } from "../server-actions/metadata-actions";
import { createChatServerThreadActions } from "../server-actions/thread-actions";
import { ChatConnectionController } from "./connection-controller";
import { createChatReconnectActions } from "./reconnect-actions";
import type { ServerRequestActions } from "../requests/server-request-actions";
import type { ChatThreadGoalActions } from "../threads/thread-goal-actions";
import type { ThreadRenameController } from "../threads/thread-rename-controller";
import { ChatInboundController } from "../inbound/controller";
import type { ChatPanelContext } from "../panel/context";

export function createChatServerActionControllers(
  context: ChatPanelContext,
  refs: {
    connection: ConnectionManager;
    goals: ChatThreadGoalActions;
  },
) {
  const { plugin, runtime } = context;
  const stateStore = context.state.stateStore;
  const serverActionHost = {
    stateStore,
    vaultPath: plugin.vaultPath,
    currentClient: () => refs.connection.currentClient(),
  };
  const serverMetadata = createChatServerMetadataActions({
    ...serverActionHost,
    publishAppServerMetadata: (metadata) => {
      plugin.publishAppServerMetadata(metadata);
    },
  });
  const serverDiagnostics = createChatServerDiagnosticsActions({
    ...serverActionHost,
    publishAppServerMetadata: (metadata) => {
      plugin.publishAppServerMetadata(metadata);
    },
    serverMetadataSnapshot: () => serverMetadata.serverMetadataSnapshot(),
  });
  const serverThreads = createChatServerThreadActions({
    ...serverActionHost,
    runtimeSnapshot: runtime.runtimeSnapshot,
    publishThreadList: (threads) => {
      plugin.applyThreadListSnapshot(threads);
    },
    syncThreadGoal: (threadId) => {
      void refs.goals.syncThreadGoal(threadId);
    },
  });

  return { serverThreads, serverMetadata, serverDiagnostics };
}

export function createChatInboundController(
  context: ChatPanelContext,
  refs: {
    serverMetadata: ChatServerMetadataActions;
    serverDiagnostics: ChatServerDiagnosticsActions;
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
      void refs.serverMetadata.refreshPublishedRateLimits();
    },
    refreshSkills: (forceReload) => void thread.refreshSkills(forceReload),
    publishAppServerMetadata: thread.publishAppServerMetadataSnapshot,
    maybeNameThread: (threadId, turn) => {
      refs.threadRename.maybeAutoNameThread(threadId, turn);
    },
    notifyThreadArchived: plugin.notifyThreadArchived.bind(plugin),
    notifyThreadRenamed: plugin.notifyThreadRenamed.bind(plugin),
    recordMcpStartupStatus: (name, status, message) => {
      refs.serverDiagnostics.recordMcpStartupStatus(name, status, message);
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
    serverMetadata: ChatServerMetadataActions;
    serverDiagnostics: ChatServerDiagnosticsActions;
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
        refreshPublishedAppServerMetadata: () => refs.serverMetadata.refreshPublishedAppServerMetadata(),
        refreshPublishedSkills: (forceReload) => refs.serverMetadata.refreshPublishedSkills(forceReload),
      },
      diagnostics: {
        refreshPublishedDiagnosticProbes: () => refs.serverDiagnostics.refreshPublishedDiagnosticProbes(),
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
