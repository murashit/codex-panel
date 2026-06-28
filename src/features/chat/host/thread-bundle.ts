import { Notice } from "obsidian";

import { recoverRolloutTokenUsage } from "../../../app-server/services/rollout-token-usage";
import { normalizeExplicitThreadName } from "../../../domain/threads/model";
import type { LocalIdSource } from "../../../shared/id/local-id";
import { createThreadOperations, type ThreadOperations } from "../../threads/workflows/thread-operations";
import { createThreadTitleService, type ThreadTitleService } from "../../threads/workflows/thread-title-service";
import type { ChatServerThreadActions } from "../app-server/actions/threads";
import type { ChatAppServerGateway } from "../app-server/session-gateway";
import { messageStreamItems } from "../application/state/message-stream";
import type { ChatStateStore } from "../application/state/store";
import type { ActiveThreadIdentitySync } from "../application/threads/active-thread-identity-sync";
import { type AutoTitleCoordinator, createAutoTitleCoordinator } from "../application/threads/auto-title-coordinator";
import { createGoalActions, createThreadGoalSyncActions } from "../application/threads/goal-actions";
import { HistoryController } from "../application/threads/history-controller";
import { createThreadLifecycleParts } from "../application/threads/lifecycle-parts";
import {
  activeThreadRenameTitleContext,
  createThreadRenameEditorActions,
  type ThreadRenameEditorActions,
} from "../application/threads/rename-editor-actions";
import type { RestorationController } from "../application/threads/restoration-controller";
import type { ResumeActions } from "../application/threads/resume-actions";
import type { ChatResumeWorkTracker } from "../application/threads/resume-work";
import { createThreadManagementActions, type ThreadManagementActionsHost } from "../application/threads/thread-management-actions";
import { createThreadNavigationActions } from "../application/threads/thread-navigation-actions";
import { threadTitleContextFromMessageStreamItems } from "../application/threads/title-context";
import type { ChatComposerController } from "../panel/composer-controller";
import { createToolbarPanelActions, type ToolbarPanelActions } from "../panel/toolbar-actions";
import type { ChatPanelEnvironment } from "./contracts";

type ChatPanelGoalSyncActions = ReturnType<typeof createThreadGoalSyncActions>;
export type ChatPanelGoalActions = ReturnType<typeof createGoalActions>;
export type ChatPanelThreadLifecycle = ReturnType<typeof createThreadLifecycleParts>;
export type ChatPanelThreadActions = ReturnType<typeof createThreadManagementActions>;
export type ChatPanelThreadNavigationActions = ReturnType<typeof createThreadNavigationActions>;

interface ChatPanelThreadStatus {
  set: (statusText: string) => void;
  addSystemMessage: (text: string) => void;
}

interface ChatPanelThreadHost {
  environment: ChatPanelEnvironment;
  stateStore: ChatStateStore;
  resumeWork: ChatResumeWorkTracker;
  messageScrollController: {
    showLatest(): void;
  };
  getClosing: () => boolean;
}

interface ChatPanelThreadFoundationInput {
  appServer: ChatAppServerGateway;
  localItemIds: LocalIdSource;
  status: ChatPanelThreadStatus;
  refreshLiveState: () => void;
}

interface ChatPanelThreadFoundation {
  titleService: ThreadTitleService;
  autoTitleCoordinator: AutoTitleCoordinator;
  history: HistoryController;
  goalSync: ChatPanelGoalSyncActions;
  threadOperations: ThreadOperations;
  invalidateThreadWork(): void;
}

interface ChatPanelThreadLifecycleInput {
  appServer: ChatAppServerGateway;
  localItemIds: LocalIdSource;
  ensureConnected: () => Promise<void>;
  status: ChatPanelThreadStatus;
  serverThreads: ChatServerThreadActions;
  foundation: ChatPanelThreadFoundation;
  refreshTabHeader: () => void;
  refreshLiveState: () => void;
  notifyActiveThreadIdentityChanged: () => void;
}

interface ChatPanelThreadLifecycleBundle {
  goals: ChatPanelGoalActions;
  rename: ThreadRenameEditorActions;
  lifecycle: ChatPanelThreadLifecycle;
  identity: ActiveThreadIdentitySync;
  restoration: RestorationController;
  resume: ResumeActions;
}

interface ChatPanelThreadActionInput {
  appServer: ChatAppServerGateway;
  status: ChatPanelThreadStatus;
  composerController: ChatComposerController;
  foundation: ChatPanelThreadFoundation;
  lifecycle: ChatPanelThreadLifecycleBundle;
  refreshActiveThreads: () => Promise<void>;
  notifyActiveThreadIdentityChanged: () => void;
}

interface ChatPanelThreadActionBundle {
  actions: ChatPanelThreadActions;
  toolbarPanelActions: ToolbarPanelActions;
  navigation: ChatPanelThreadNavigationActions;
}

export function createThreadFoundation(host: ChatPanelThreadHost, input: ChatPanelThreadFoundationInput): ChatPanelThreadFoundation {
  const { appServer, localItemIds, status, refreshLiveState } = input;
  const titleService = createSessionThreadTitleService(host, appServer);
  const autoTitleCoordinator = createSessionAutoTitleCoordinator(host, appServer, titleService);
  const history = createSessionHistoryController(host, appServer, status, autoTitleCoordinator);
  const invalidateThreadWork = () => {
    host.resumeWork.invalidate();
    history.invalidate();
  };
  const goalSync = createSessionGoalSyncActions(host, appServer, localItemIds, status, refreshLiveState);
  const threadOperations = createSessionThreadOperations(host.environment, appServer);

  return {
    titleService,
    autoTitleCoordinator,
    history,
    goalSync,
    threadOperations,
    invalidateThreadWork,
  };
}

export function createThreadLifecycleBundle(
  host: ChatPanelThreadHost,
  input: ChatPanelThreadLifecycleInput,
): ChatPanelThreadLifecycleBundle {
  const {
    appServer,
    localItemIds,
    ensureConnected,
    status,
    serverThreads,
    foundation,
    refreshTabHeader,
    refreshLiveState,
    notifyActiveThreadIdentityChanged,
  } = input;
  const goals = createSessionGoalActions(host, appServer, localItemIds, status, serverThreads, refreshLiveState);
  const rename = createSessionThreadRenameEditorActions(
    host.stateStore,
    foundation.threadOperations,
    foundation.titleService,
    ensureConnected,
    status,
  );
  const lifecycle = createSessionThreadLifecycle(host, {
    appServer,
    status,
    goals,
    autoTitleCoordinator: foundation.autoTitleCoordinator,
    history: foundation.history,
    invalidateThreadWork: () => {
      foundation.invalidateThreadWork();
    },
    refreshTabHeader,
    refreshLiveState,
    notifyActiveThreadIdentityChanged,
  });
  const { identity, restoration, resume } = lifecycle;

  return {
    goals,
    rename,
    lifecycle,
    identity,
    restoration,
    resume,
  };
}

export function createThreadActionBundle(host: ChatPanelThreadHost, input: ChatPanelThreadActionInput): ChatPanelThreadActionBundle {
  const { appServer, status, composerController, foundation, lifecycle, refreshActiveThreads, notifyActiveThreadIdentityChanged } = input;
  const { environment, stateStore } = host;
  const threadManagementHost: ThreadManagementActionsHost = {
    stateStore,
    operations: {
      renameThread: (threadId, value) => foundation.threadOperations.renameThread(threadId, value),
      archiveThread: async (threadId, options) => (await foundation.threadOperations.archiveThread(threadId, options)) !== null,
    },
    threadTransport: appServer.threadMutation,
    addSystemMessage: status.addSystemMessage,
    setStatus: status.set,
    setComposerText: (text) => {
      composerController.setDraft(text, { focus: true });
    },
    openThreadInNewView: (threadId) => environment.plugin.workspace.openThreadInNewView(threadId),
    openThreadInCurrentPanel: (threadId) => lifecycle.resume.resumeThread(threadId),
    notifyActiveThreadIdentityChanged,
    refreshAfterThreadMutation: async () => {
      await refreshActiveThreads();
    },
    recordForkedThread: (thread) => {
      environment.plugin.threadCatalog.apply({ type: "thread-forked", thread });
    },
  };
  const actions = createThreadManagementActions(threadManagementHost);
  const toolbarPanelActions = createToolbarPanelActions({
    stateStore,
    threadActions: actions,
  });
  const navigation = createThreadNavigationActions({
    stateStore,
    identity: lifecycle.identity,
    closeForThreadSelection: () => {
      toolbarPanelActions.closeForThreadSelection();
    },
    focusThreadInOpenView: (threadId) => environment.plugin.workspace.focusThreadInOpenView(threadId),
    resumeThread: (threadId) => lifecycle.resume.resumeThread(threadId),
    addSystemMessage: status.addSystemMessage,
    focusComposer: () => {
      composerController.focusComposer();
    },
  });
  return { actions, toolbarPanelActions, navigation };
}

function createSessionThreadTitleService(host: ChatPanelThreadHost, appServer: ChatAppServerGateway): ThreadTitleService {
  const { environment, stateStore } = host;
  return createThreadTitleService({
    codexPath: () => environment.plugin.settingsRef.settings.codexPath(),
    vaultPath: environment.plugin.settingsRef.vaultPath,
    threadNamingModel: () => environment.plugin.settingsRef.settings.threadNamingModel(),
    threadNamingEffort: () => environment.plugin.settingsRef.settings.threadNamingEffort(),
    clientAccess: appServer.clientAccess,
    visibleContext: (threadId) => activeThreadRenameTitleContext(stateStore.getState(), threadId),
    visibleCompletedTurnContext: (turnId) =>
      threadTitleContextFromMessageStreamItems(turnId, messageStreamItems(stateStore.getState().messageStream)),
  });
}

function createSessionAutoTitleCoordinator(
  host: ChatPanelThreadHost,
  appServer: ChatAppServerGateway,
  titleService: ThreadTitleService,
): AutoTitleCoordinator {
  return createAutoTitleCoordinator({
    stateStore: host.stateStore,
    completedTurnTitleContext: (turnId, completedSummary) => titleService.completedTurnContext(turnId, completedSummary),
    generateTitleFromContext: (context) => titleService.generate(context),
    renameGeneratedTitle: async (threadId, title, options) => {
      const name = normalizeExplicitThreadName(title);
      if (!name) return false;
      if (!(await appServer.renameThread(threadId, name))) return false;
      if (options.shouldPublish()) {
        host.environment.plugin.threadCatalog.apply({ type: "thread-renamed", threadId, name });
      }
      return true;
    },
  });
}

function createSessionHistoryController(
  host: ChatPanelThreadHost,
  appServer: ChatAppServerGateway,
  status: ChatPanelThreadStatus,
  autoTitleCoordinator: AutoTitleCoordinator,
): HistoryController {
  return new HistoryController({
    stateStore: host.stateStore,
    historyTransport: appServer.threadHistory,
    addSystemMessage: status.addSystemMessage,
    showLatestPageAtBottom: () => {
      host.messageScrollController.showLatest();
    },
    setThreadTurnPresence: (hadTurns) => {
      autoTitleCoordinator.resetThreadTurnPresence(hadTurns);
    },
  });
}

function createSessionGoalSyncActions(
  host: ChatPanelThreadHost,
  appServer: ChatAppServerGateway,
  localItemIds: LocalIdSource,
  status: ChatPanelThreadStatus,
  refreshLiveState: () => void,
): ChatPanelGoalSyncActions {
  return createThreadGoalSyncActions({
    stateStore: host.stateStore,
    goalTransport: appServer.threadGoalRead,
    localItemIds,
    addSystemMessage: (text) => {
      status.addSystemMessage(text);
    },
    addGoalEvent: (item) => {
      host.stateStore.dispatch({ type: "message-stream/item-upserted", item });
    },
    refreshLiveState,
  });
}

function createSessionThreadOperations(environment: ChatPanelEnvironment, appServer: ChatAppServerGateway): ThreadOperations {
  return createThreadOperations({
    clientAccess: appServer.clientAccess,
    archiveExport: {
      settings: () => environment.plugin.settingsRef.settings.archiveExportSettings(),
      enabled: () => environment.plugin.settingsRef.settings.archiveExportEnabled(),
      vaultPath: environment.plugin.settingsRef.vaultPath,
      vaultConfigDir: environment.obsidian.app.vault.configDir,
    },
    archiveDestination: environment.obsidian.archiveDestination,
    catalog: environment.plugin.threadCatalog,
    notice: (text) => {
      new Notice(text);
    },
  });
}

function createSessionGoalActions(
  host: ChatPanelThreadHost,
  appServer: ChatAppServerGateway,
  localItemIds: LocalIdSource,
  status: ChatPanelThreadStatus,
  serverThreads: ChatServerThreadActions,
  refreshLiveState: () => void,
): ChatPanelGoalActions {
  return createGoalActions({
    stateStore: host.stateStore,
    goalTransport: appServer.threadGoal,
    localItemIds,
    startThread: (preview, options) => serverThreads.startThread(preview, options),
    addSystemMessage: (text) => {
      status.addSystemMessage(text);
    },
    addGoalEvent: (item) => {
      host.stateStore.dispatch({ type: "message-stream/item-upserted", item });
    },
    refreshLiveState,
  });
}

function createSessionThreadRenameEditorActions(
  stateStore: ChatStateStore,
  operations: ThreadOperations,
  titleService: ThreadTitleService,
  ensureConnected: () => Promise<void>,
  status: ChatPanelThreadStatus,
): ThreadRenameEditorActions {
  return createThreadRenameEditorActions({
    stateStore,
    ensureConnected,
    addSystemMessage: status.addSystemMessage,
    renameThread: (threadId, value) => operations.renameThread(threadId, value),
    generateThreadTitle: (threadId) => titleService.generateTitle(threadId),
  });
}

function createSessionThreadLifecycle(
  host: ChatPanelThreadHost,
  input: {
    appServer: ChatAppServerGateway;
    status: ChatPanelThreadStatus;
    goals: ChatPanelGoalActions;
    autoTitleCoordinator: AutoTitleCoordinator;
    history: HistoryController;
    invalidateThreadWork: () => void;
    refreshTabHeader: () => void;
    refreshLiveState: () => void;
    notifyActiveThreadIdentityChanged: () => void;
  },
): ChatPanelThreadLifecycle {
  const {
    appServer,
    status,
    goals,
    autoTitleCoordinator,
    history,
    invalidateThreadWork,
    refreshTabHeader,
    refreshLiveState,
    notifyActiveThreadIdentityChanged,
  } = input;
  return createThreadLifecycleParts({
    stateStore: host.stateStore,
    resumeTransport: appServer.threadResume,
    lifecycle: {
      resumeWork: host.resumeWork,
      history,
      invalidateThreadWork,
      getClosing: host.getClosing,
      recoverTokenUsageFromRollout: (path) =>
        recoverRolloutTokenUsage(path, (filePath, options) => appServer.readFileBase64(filePath, options)),
    },
    thread: {
      notifyIdentityChanged: notifyActiveThreadIdentityChanged,
      refreshTabHeader,
    },
    status,
    liveState: {
      refresh: refreshLiveState,
    },
    goals,
    resetThreadTurnPresence: (hadTurns) => {
      autoTitleCoordinator.resetThreadTurnPresence(hadTurns);
    },
  });
}
