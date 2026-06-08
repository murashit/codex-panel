import { Notice } from "obsidian";

import type { ConnectionManager } from "../../../app-server/connection-manager";
import { ChatAppServerDiagnosticsController } from "../app-server/diagnostics-controller";
import { ChatAppServerMetadataController } from "../app-server/metadata-controller";
import { ChatAppServerThreadController } from "../app-server/thread-controller";
import { ChatConnectionController } from "./connection-controller";
import type { ServerRequestActions } from "../requests/server-request-actions";
import type { ChatThreadGoalController } from "../threads/thread-goal-controller";
import type { ThreadRenameController } from "../threads/thread-rename-controller";
import { ChatInboundController } from "../inbound/controller";
import type { ChatPanelContext } from "../panel/context";

export function createChatAppServerControllers(
  context: ChatPanelContext,
  refs: {
    connection: ConnectionManager;
    goals: ChatThreadGoalController;
  },
) {
  const { plugin, runtime, scroll } = context;
  const stateStore = context.state.stateStore;
  const appServerBaseHost = {
    stateStore,
    vaultPath: plugin.vaultPath,
    currentClient: () => refs.connection.currentClient(),
  };
  const appServerMetadata = new ChatAppServerMetadataController({
    ...appServerBaseHost,
    publishAppServerMetadata: (metadata) => {
      plugin.publishAppServerMetadata(metadata);
    },
  });
  const appServerDiagnostics = new ChatAppServerDiagnosticsController({
    ...appServerBaseHost,
    publishAppServerMetadata: (metadata) => {
      plugin.publishAppServerMetadata(metadata);
    },
    appServerMetadataSnapshot: () => appServerMetadata.appServerMetadataSnapshot(),
  });
  const appServerThreads = new ChatAppServerThreadController({
    ...appServerBaseHost,
    runtimeSnapshot: runtime.runtimeSnapshot,
    forceMessagesToBottom: scroll.forceBottom,
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
    appServerMetadata: ChatAppServerMetadataController;
    appServerDiagnostics: ChatAppServerDiagnosticsController;
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
    appServerMetadata: ChatAppServerMetadataController;
    appServerDiagnostics: ChatAppServerDiagnosticsController;
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
