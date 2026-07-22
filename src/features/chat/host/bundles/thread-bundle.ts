import { Notice } from "obsidian";

import { recoverRolloutTokenUsage } from "../../../../app-server/services/rollout-token-usage";
import { createThreadOperationsTransport } from "../../../threads/app-server/workflow-transports";
import { createThreadOperations, type ThreadOperations } from "../../../threads/workflows/thread-operations";
import { createThreadTitleService, type ThreadTitleService } from "../../../threads/workflows/thread-title-service";
import type { ChatAppServerGateway, ChatCurrentAppServerGateway } from "../../app-server/session-gateway";
import type { LocalIdSource } from "../../application/local-id-source";
import type { ChatStateStore } from "../../application/state/store";
import { threadStreamItems } from "../../application/state/thread-stream";
import { type ActiveThreadIdentitySync, createActiveThreadIdentitySync } from "../../application/threads/active-thread-identity-sync";
import { type AutoTitleCoordinator, createAutoTitleCoordinator } from "../../application/threads/auto-title-coordinator";
import {
  createGoalActions,
  createThreadGoalSyncActions,
  type ThreadGoalOperationCoordinator,
} from "../../application/threads/goal-actions";
import { HistoryController } from "../../application/threads/history-controller";
import type { PersistentNavigationLifecycle } from "../../application/threads/persistent-navigation-lifecycle";
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
  beginPanelActivityPublication(replacementThreadId: string): { publish(commit: () => void): void };
}

interface ChatPanelThreadFoundationInput {
  appServer: ChatCurrentAppServerGateway;
  localItemIds: LocalIdSource;
  status: ChatPanelThreadStatus;
}

interface ChatPanelThreadFoundation {
  titleService: ThreadTitleService;
  autoTitleCoordinator: AutoTitleCoordinator;
  history: HistoryController;
  goalSync: ChatPanelGoalSyncActions;
  goalOperations: ThreadGoalOperationCoordinator;
  threadOperations: ThreadOperations;
  invalidateThreadWork(): void;
}

interface ChatPanelThreadLifecycleInput {
  appServer: ChatAppServerGateway;
  localItemIds: LocalIdSource;
  ensureConnected: () => Promise<void>;
  ensureInitialized: () => Promise<void>;
  status: ChatPanelThreadStatus;
  threadStart: ThreadStartActions;
  foundation: ChatPanelThreadFoundation;
  notifyActiveThreadIdentityChanged: () => void;
}

interface ChatPanelThreadLifecycleBundle extends ChatPanelThreadLifecycle {
  goals: ChatPanelGoalActions;
  rename: ThreadRenameEditorActions;
}

interface ChatPanelThreadActionInput {
  appServer: ChatAppServerGateway;
  status: ChatPanelThreadStatus;
  composerController: ChatComposerController;
  foundation: ChatPanelThreadFoundation;
  lifecycle: ChatPanelThreadLifecycleBundle;
  notifyActiveThreadIdentityChanged: () => void;
  navigation: PersistentNavigationLifecycle;
}

interface ChatPanelThreadActionBundle {
  actions: ChatPanelThreadActions;
  toolbarPanelActions: ToolbarPanelActions;
  navigation: ChatPanelThreadNavigationActions;
}

export function createThreadFoundation(host: ChatPanelThreadHost, input: ChatPanelThreadFoundationInput): ChatPanelThreadFoundation {
  const { appServer, localItemIds, status } = input;
  const { environment, stateStore } = host;
  const threadOperationsTransport = createThreadOperationsTransport(appServer.clientAccess);
  const titleService = createThreadTitleService({
    transport: environment.plugin.threadTitleTransport,
    visibleContext: (threadId) => activeThreadRenameTitleContext(stateStore.getState(), threadId),
    visibleCompletedTurnContext: (turnId) =>
      threadTitleContextFromThreadStreamItems(turnId, threadStreamItems(stateStore.getState().threadStream)),
  });
  const threadOperations = createThreadOperations({
    transport: threadOperationsTransport,
    nameMutations: environment.plugin.threadNameMutations,
    archiveExport: {
      settings: () => environment.plugin.settings.archiveExportSettings(),
      enabled: () => environment.plugin.settings.archiveExportEnabled(),
      vaultPath: environment.plugin.appServerContext.vaultPath,
      vaultConfigDir: environment.obsidian.app.vault.configDir,
    },
    archiveDestination: environment.obsidian.archiveDestination,
    operationEvents: environment.plugin.threadOperationCoordinator,
    referenceThreads: () => stateStore.getState().threadList.listedThreads,
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
  const goalOperations = environment.plugin.threadGoalOperations;
  const goalSync = createThreadGoalSyncActions(
    {
      stateStore,
      goalTransport: appServer.threadGoalRead,
      localItemIds,
      addSystemMessage: (text) => {
        status.addSystemMessage(text);
      },
      addGoalEvent: (item) => {
        stateStore.dispatch({ type: "thread-stream/item-upserted", item });
      },
    },
    goalOperations,
  );

  return {
    titleService,
    autoTitleCoordinator,
    history,
    goalSync,
    goalOperations,
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
    ensureInitialized,
    status,
    threadStart,
    foundation,
    notifyActiveThreadIdentityChanged,
  } = input;
  const lifecycle = createSessionThreadLifecycle(host, {
    appServer,
    ensureInitialized,
    status,
    goalSync: foundation.goalSync,
    autoTitleCoordinator: foundation.autoTitleCoordinator,
    history: foundation.history,
    invalidateThreadWork: () => {
      foundation.invalidateThreadWork();
    },
    notifyActiveThreadIdentityChanged,
  });
  const goals = createGoalActions(
    {
      stateStore: host.stateStore,
      goalTransport: appServer.threadGoal,
      localItemIds,
      startThread: (preview, options) => threadStart.startThread(preview, options),
      ensureRestoredThreadLoaded: () =>
        lifecycle.restoration.ensureLoaded(async (threadId) => {
          await lifecycle.resume.resumeThread(threadId);
        }),
      addSystemMessage: (text) => {
        status.addSystemMessage(text);
      },
      addGoalEvent: (item) => {
        host.stateStore.dispatch({ type: "thread-stream/item-upserted", item });
      },
    },
    foundation.goalOperations,
  );
  const rename = createThreadRenameEditorActions({
    stateStore: host.stateStore,
    ensureConnected,
    addSystemMessage: status.addSystemMessage,
    renameThread: (threadId, value) => foundation.threadOperations.renameThread(threadId, value),
    resolveThreadTitleContext: (threadId) => foundation.titleService.resolveContext(threadId),
    generateThreadTitle: (context, signal) => foundation.titleService.generate(context, signal),
  });
  const { identity, restoration, resume } = lifecycle;

  return {
    goals,
    rename,
    identity,
    restoration,
    resume,
  };
}

export function createThreadActionBundle(host: ChatPanelThreadHost, input: ChatPanelThreadActionInput): ChatPanelThreadActionBundle {
  const { appServer, status, composerController, foundation, lifecycle } = input;
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
    openThreadInCurrentPanel: async (threadId, onAdopted) => {
      const activityPublication = host.beginPanelActivityPublication(threadId);
      const adoption = { completed: false };
      try {
        await lifecycle.resume.resumeThread(threadId, undefined, {
          onAdopted: () => {
            adoption.completed = true;
            onAdopted();
          },
        });
        if (adoption.completed) return { adopted: true, activityPublication };
        activityPublication.publish(() => undefined);
        return { adopted: false };
      } catch (error) {
        activityPublication.publish(() => undefined);
        throw error;
      }
    },
    beginThreadForkPublication: (sourceThreadId) => environment.plugin.threadOperationCoordinator.beginForkPublication(sourceThreadId),
    threadHasPendingOrRunningPanel: (threadId) => environment.plugin.workspace.threadHasPendingOrRunningPanel(threadId),
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
    openThreadFromHistory: (threadId, originSwitchable) =>
      environment.plugin.workspace.openThreadFromPanel(threadId, environment.obsidian.viewId, originSwitchable),
    resumeThread: (threadId, intent, options) => lifecycle.resume.resumeThread(threadId, intent, options),
    resumeWork: host.resumeWork,
    addSystemMessage: status.addSystemMessage,
    focusComposer: () => {
      composerController.focusComposer();
    },
    navigation: input.navigation,
  });
  return { actions, toolbarPanelActions, navigation };
}

function createSessionThreadLifecycle(
  host: ChatPanelThreadHost,
  input: {
    appServer: ChatAppServerGateway;
    ensureInitialized: () => Promise<void>;
    status: ChatPanelThreadStatus;
    goalSync: ChatPanelGoalSyncActions;
    autoTitleCoordinator: AutoTitleCoordinator;
    history: HistoryController;
    invalidateThreadWork: () => void;
    notifyActiveThreadIdentityChanged: () => void;
  },
): ChatPanelThreadLifecycle {
  const {
    appServer,
    ensureInitialized,
    status,
    goalSync,
    autoTitleCoordinator,
    history,
    invalidateThreadWork,
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
    resumeTransport: {
      ensureConnected: async () => {
        await ensureInitialized();
        return appServer.connectionAvailable();
      },
      resumeThread: (threadId) => appServer.threadResume.resumeThread(threadId),
    },
    resumeWork: host.resumeWork,
    history,
    closing: host.getClosing,
    resetThreadTurnPresence,
    notifyActiveThreadIdentityChanged,
    recordResumedThread: (thread) => {
      host.environment.plugin.threadOperationCoordinator.apply({ type: "thread-upserted", thread });
    },
    addSystemMessage: status.addSystemMessage,
    syncThreadGoal: (threadId) => goalSync.syncThreadGoal(threadId),
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
    restoration,
    resume,
    identity,
  };
}
