import { Notice } from "obsidian";

import { appServerQueryContextIdentity, appServerQueryContextIdentityMatches } from "../../../../app-server/query/keys";
import { recoverRolloutTokenUsage } from "../../../../app-server/services/rollout-token-usage";
import { createThreadOperationsTransport, createThreadTitleTransport } from "../../../threads/app-server/workflow-transports";
import { createThreadOperations, type ThreadOperations } from "../../../threads/workflows/thread-operations";
import { createThreadTitleService, type ThreadTitleService } from "../../../threads/workflows/thread-title-service";
import type { ChatAppServerGateway, ChatCurrentAppServerGateway } from "../../app-server/session-gateway";
import type { LocalIdSource } from "../../application/local-id-source";
import type { ChatStateStore } from "../../application/state/store";
import { threadStreamItems } from "../../application/state/thread-stream";
import { type ActiveThreadIdentitySync, createActiveThreadIdentitySync } from "../../application/threads/active-thread-identity-sync";
import { type AutoTitleCoordinator, createAutoTitleCoordinator } from "../../application/threads/auto-title-coordinator";
import { createGoalActions, createThreadGoalSyncActions } from "../../application/threads/goal-actions";
import { HistoryController } from "../../application/threads/history-controller";
import {
  activeThreadRenameTitleContext,
  createThreadRenameEditorActions,
  type ThreadRenameEditorActions,
} from "../../application/threads/rename-editor-actions";
import { RestorationController } from "../../application/threads/restoration-controller";
import { createResumeActions, type ResumeActions } from "../../application/threads/resume-actions";
import type { ChatResumeWorkTracker } from "../../application/threads/resume-work";
import { createThreadManagementActions, type ThreadManagementActionsHost } from "../../application/threads/thread-management-actions";
import { createThreadNavigationActions } from "../../application/threads/thread-navigation-actions";
import type { ThreadStartActions } from "../../application/threads/thread-start-actions";
import { threadTitleContextFromThreadStreamItems } from "../../application/threads/title-context";
import type { ChatComposerController } from "../../panel/composer-controller";
import { createToolbarPanelActions, type ToolbarPanelActions } from "../../panel/toolbar-actions";
import type { ChatPanelEnvironment } from "../contracts";

type ChatPanelGoalSyncActions = ReturnType<typeof createThreadGoalSyncActions>;
export type ChatPanelGoalActions = ReturnType<typeof createGoalActions>;
export type ChatPanelThreadActions = ReturnType<typeof createThreadManagementActions>;
export type ChatPanelThreadNavigationActions = ReturnType<typeof createThreadNavigationActions>;

export interface ChatPanelThreadLifecycle {
  history: HistoryController;
  restoration: RestorationController;
  resume: ResumeActions;
  identity: ActiveThreadIdentitySync;
}

interface ChatPanelThreadStatus {
  set: (statusText: string) => void;
  addSystemMessage: (text: string) => void;
}

interface ChatPanelThreadHost {
  environment: ChatPanelEnvironment;
  stateStore: ChatStateStore;
  resumeWork: ChatResumeWorkTracker;
  threadStreamScrollBinding: {
    showLatest(): void;
  };
  getClosing: () => boolean;
}

interface ChatPanelThreadFoundationInput {
  appServer: ChatCurrentAppServerGateway;
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
  threadStart: ThreadStartActions;
  foundation: ChatPanelThreadFoundation;
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
  prepareForPersistentNavigation: () => Promise<boolean>;
}

interface ChatPanelThreadActionBundle {
  actions: ChatPanelThreadActions;
  toolbarPanelActions: ToolbarPanelActions;
  navigation: ChatPanelThreadNavigationActions;
}

export function createThreadFoundation(host: ChatPanelThreadHost, input: ChatPanelThreadFoundationInput): ChatPanelThreadFoundation {
  const { appServer, localItemIds, status, refreshLiveState } = input;
  const { environment, stateStore } = host;
  const threadOperationsTransport = createThreadOperationsTransport(appServer.clientAccess);
  const threadTitleTransport = createThreadTitleTransport({
    clientAccess: appServer.clientAccess,
    codexPath: () => environment.plugin.appServerQueries.contextLease().context.codexPath,
    vaultPath: environment.plugin.appServerQueries.contextLease().context.vaultPath,
    threadNamingModel: () => environment.plugin.settingsRef.settings.threadNamingModel(),
    threadNamingEffort: () => environment.plugin.settingsRef.settings.threadNamingEffort(),
  });
  const titleService = createThreadTitleService({
    transport: threadTitleTransport,
    visibleContext: (threadId) => activeThreadRenameTitleContext(stateStore.getState(), threadId),
    visibleCompletedTurnContext: (turnId) =>
      threadTitleContextFromThreadStreamItems(turnId, threadStreamItems(stateStore.getState().threadStream)),
  });
  const threadOperations = createThreadOperations({
    transport: threadOperationsTransport,
    nameMutations: environment.plugin.threadNameMutations,
    resourceContext: {
      capture: () => appServerQueryContextIdentity(environment.plugin.appServerQueries.contextLease()),
      isCurrent: (context) => {
        try {
          return appServerQueryContextIdentityMatches(
            context,
            appServerQueryContextIdentity(environment.plugin.appServerQueries.contextLease()),
          );
        } catch {
          return false;
        }
      },
    },
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
  const autoTitleCoordinator = createAutoTitleCoordinator({
    stateStore,
    completedTurnTitleContext: (turnId, completedTurnTranscriptSummary) =>
      titleService.completedTurnContext(turnId, completedTurnTranscriptSummary),
    generateTitleFromContext: (context) => titleService.generate(context),
    renameGeneratedTitle: (threadId, title, options) =>
      threadOperations.renameThread(threadId, title, {
        shouldStart: options.shouldStart,
        shouldPublish: options.shouldPublish,
      }),
  });
  const history = new HistoryController({
    stateStore,
    historyTransport: appServer.threadHistory,
    addSystemMessage: status.addSystemMessage,
    showLatestPageAtBottom: () => {
      host.threadStreamScrollBinding.showLatest();
    },
    setThreadTurnPresence: (hadTurns) => {
      autoTitleCoordinator.resetThreadTurnPresence(hadTurns);
    },
  });
  const invalidateThreadWork = () => {
    host.resumeWork.invalidate();
    history.invalidate();
    titleService.invalidate();
    autoTitleCoordinator.invalidate();
  };
  const goalSync = createThreadGoalSyncActions({
    stateStore,
    goalTransport: appServer.threadGoalRead,
    localItemIds,
    addSystemMessage: (text) => {
      status.addSystemMessage(text);
    },
    addGoalEvent: (item) => {
      stateStore.dispatch({ type: "thread-stream/item-upserted", item });
    },
    refreshLiveState,
  });

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
  const { appServer, localItemIds, ensureConnected, status, threadStart, foundation, refreshLiveState, notifyActiveThreadIdentityChanged } =
    input;
  const goals = createGoalActions({
    stateStore: host.stateStore,
    goalTransport: appServer.threadGoal,
    localItemIds,
    startThread: (preview, options) => threadStart.startThread(preview, options),
    addSystemMessage: (text) => {
      status.addSystemMessage(text);
    },
    addGoalEvent: (item) => {
      host.stateStore.dispatch({ type: "thread-stream/item-upserted", item });
    },
    refreshLiveState,
  });
  const rename = createThreadRenameEditorActions({
    stateStore: host.stateStore,
    ensureConnected,
    addSystemMessage: status.addSystemMessage,
    renameThread: (threadId, value) => foundation.threadOperations.renameThread(threadId, value),
    generateThreadTitle: (threadId) => foundation.titleService.generateTitle(threadId),
  });
  const lifecycle = createSessionThreadLifecycle(host, {
    appServer,
    status,
    goals,
    autoTitleCoordinator: foundation.autoTitleCoordinator,
    history: foundation.history,
    invalidateThreadWork: () => {
      foundation.invalidateThreadWork();
    },
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
      archiveThread: async (threadId, options) => {
        await foundation.threadOperations.archiveThread(threadId, options);
        return true;
      },
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
    prepareForPersistentNavigation: input.prepareForPersistentNavigation,
  });
  return { actions, toolbarPanelActions, navigation };
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
    refreshLiveState,
    notifyActiveThreadIdentityChanged,
  } = input;
  const restoration = new RestorationController({
    stateStore: host.stateStore,
  });
  const resetThreadTurnPresence = (hadTurns: boolean) => {
    autoTitleCoordinator.resetThreadTurnPresence(hadTurns);
  };
  const resume = createResumeActions({
    stateStore: host.stateStore,
    resumeTransport: appServer.threadResume,
    resumeWork: host.resumeWork,
    history,
    closing: host.getClosing,
    resetThreadTurnPresence,
    notifyActiveThreadIdentityChanged,
    addSystemMessage: status.addSystemMessage,
    refreshLiveState,
    syncThreadGoal: (threadId) => goals.syncThreadGoal(threadId),
    recoverTokenUsageFromRollout: (path) =>
      recoverRolloutTokenUsage(path, (filePath, options) => appServer.readFileBase64(filePath, options)),
  });
  const identity = createActiveThreadIdentitySync({
    stateStore: host.stateStore,
    invalidateThreadWork,
    resetThreadTurnPresence,
    notifyActiveThreadIdentityChanged,
  });

  return {
    history,
    restoration,
    resume,
    identity,
  };
}
