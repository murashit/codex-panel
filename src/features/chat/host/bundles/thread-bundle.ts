import { Notice } from "obsidian";

import { recoverRolloutTokenUsage } from "../../../../app-server/services/rollout-token-usage";
import { createThreadMutationAdapter } from "../../../threads/app-server/workflow-adapters";
import { createThreadMutationCommands, type ThreadMutationCommands } from "../../../threads/workflows/thread-mutation-commands";
import { createThreadTitleService, type ThreadTitleService } from "../../../threads/workflows/thread-title-service";
import type { ChatAppServerGateway, ChatCurrentAppServerGateway } from "../../app-server/session-gateway";
import type { LocalIdSource } from "../../application/local-id-source";
import type { ChatStateStore } from "../../application/state/store";
import { threadStreamItems } from "../../application/state/thread-stream";
import { type ActiveThreadIdentitySync, createActiveThreadIdentitySync } from "../../application/threads/active-thread-identity-sync";
import { type AutoTitleCoordinator, createAutoTitleCoordinator } from "../../application/threads/auto-title-coordinator";
import { createGoalCommands, type GoalCommands } from "../../application/threads/goal-commands";
import { createGoalEditorActions, type GoalEditorActions } from "../../application/threads/goal-editor-actions";
import { createThreadGoalSync, type ThreadGoalSync } from "../../application/threads/goal-sync";
import { HistoryController } from "../../application/threads/history-controller";
import type { PersistentNavigationLifecycle } from "../../application/threads/persistent-navigation-lifecycle";
import {
  activeThreadRenameTitleContext,
  createThreadRenameEditorActions,
  type ThreadRenameEditorActions,
} from "../../application/threads/rename-editor-actions";
import { RestorationController } from "../../application/threads/restoration-controller";
import { createResumeCommand, type ResumeCommand } from "../../application/threads/resume-command";
import type { ChatResumeWorkTracker } from "../../application/threads/resume-work";
import { createThreadCommands, type ThreadCommandsHost } from "../../application/threads/thread-commands";
import type { ThreadGoalCoordinator } from "../../application/threads/thread-goal-coordinator";
import { createThreadNavigationCommands } from "../../application/threads/thread-navigation-commands";
import type { ThreadStartCommand } from "../../application/threads/thread-start-command";
import { threadTitleContextFromThreadStreamItems } from "../../application/threads/title-context";
import type { ChatComposerController } from "../../panel/composer/controller";
import { createToolbarPanelActions, type ToolbarPanelActions } from "../../panel/toolbar/actions";
import type { ChatPanelEnvironment } from "../contracts";

type ChatPanelGoalSync = ThreadGoalSync;
export type ChatPanelGoalCommands = GoalCommands & GoalEditorActions;
export type ChatPanelThreadCommands = ReturnType<typeof createThreadCommands>;
export type ChatPanelThreadNavigationCommands = ReturnType<typeof createThreadNavigationCommands>;

export interface ChatPanelThreadLifecycle {
  restoration: RestorationController;
  resume: ResumeCommand;
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
}

interface ChatPanelThreadFoundation {
  titleService: ThreadTitleService;
  autoTitleCoordinator: AutoTitleCoordinator;
  history: HistoryController;
  goalSync: ChatPanelGoalSync;
  goalCoordinator: ThreadGoalCoordinator;
  threadMutations: ThreadMutationCommands;
  invalidateActiveThreadWork(): void;
}

interface ChatPanelThreadLifecycleInput {
  appServer: ChatAppServerGateway;
  localItemIds: LocalIdSource;
  ensureConnected: () => Promise<void>;
  status: ChatPanelThreadStatus;
  threadStart: ThreadStartCommand;
  foundation: ChatPanelThreadFoundation;
  notifyActiveThreadIdentityChanged: () => void;
}

interface ChatPanelThreadLifecycleBundle extends ChatPanelThreadLifecycle {
  goals: ChatPanelGoalCommands;
  rename: ThreadRenameEditorActions;
}

interface ChatPanelThreadCommandInput {
  appServer: ChatAppServerGateway;
  ensureConnected: () => Promise<void>;
  status: ChatPanelThreadStatus;
  composerController: ChatComposerController;
  foundation: ChatPanelThreadFoundation;
  lifecycle: ChatPanelThreadLifecycleBundle;
  notifyActiveThreadIdentityChanged: () => void;
  navigation: PersistentNavigationLifecycle;
}

interface ChatPanelThreadCommandBundle {
  commands: ChatPanelThreadCommands;
  toolbarPanelActions: ToolbarPanelActions;
  navigation: ChatPanelThreadNavigationCommands;
}

export function createThreadFoundation(host: ChatPanelThreadHost, input: ChatPanelThreadFoundationInput): ChatPanelThreadFoundation {
  const { appServer, localItemIds, status } = input;
  const { environment, stateStore } = host;
  const threadMutationPort = createThreadMutationAdapter(appServer.clientAccess);
  const titleService = createThreadTitleService({
    port: environment.plugin.threadTitlePort,
    visibleContext: (threadId) => activeThreadRenameTitleContext(stateStore.getState(), threadId),
    visibleCompletedTurnContext: (turnId) =>
      threadTitleContextFromThreadStreamItems(turnId, threadStreamItems(stateStore.getState().threadStream)),
  });
  const threadMutations = createThreadMutationCommands({
    port: threadMutationPort,
    nameMutations: environment.plugin.threadNameMutations,
    archiveExport: {
      settings: () => environment.plugin.settings.archiveExportSettings(),
      enabled: () => environment.plugin.settings.archiveExportEnabled(),
      vaultPath: environment.plugin.appServerContext.vaultPath,
      vaultConfigDir: environment.obsidian.app.vault.configDir,
    },
    archiveDestination: environment.obsidian.archiveDestination,
    facts: environment.plugin.threadFacts,
    referenceThreads: () => environment.plugin.threadCatalog.activeThreadsSnapshot() ?? [],
    notice: (text) => {
      new Notice(text);
    },
  });
  const autoTitleCoordinator = createAutoTitleCoordinator({
    stateStore,
    threadById: (threadId) => environment.plugin.threadCatalog.activeThreadsSnapshot()?.find((item) => item.id === threadId),
    completedTurnTitleContext: (turnId, completedTurnTranscriptSummary) =>
      titleService.completedTurnContext(turnId, completedTurnTranscriptSummary),
    submitTitleWork: (threadId, context) => {
      environment.plugin.threadAutoTitleWork.submit(threadId, context);
    },
  });
  const history = new HistoryController({
    stateStore,
    source: appServer.threadHistory,
    addSystemMessage: status.addSystemMessage,
    showLatestPageAtBottom: () => {
      host.threadStreamScrollBinding.showLatest();
    },
    setThreadTurnPresence: (hadTurns) => {
      autoTitleCoordinator.resetThreadTurnPresence(hadTurns);
    },
  });
  const invalidateActiveThreadWork = () => {
    host.resumeWork.invalidate();
    history.invalidate();
    titleService.invalidate();
  };
  const goalCoordinator = environment.plugin.threadGoalCoordinator;
  const goalSync = createThreadGoalSync(
    {
      stateStore,
      source: appServer.threadGoalRead,
      localItemIds,
      addSystemMessage: (text) => {
        status.addSystemMessage(text);
      },
      addGoalEvent: (item) => {
        stateStore.dispatch({ type: "thread-stream/item-upserted", item });
      },
    },
    goalCoordinator,
  );

  return {
    titleService,
    autoTitleCoordinator,
    history,
    goalSync,
    goalCoordinator,
    threadMutations,
    invalidateActiveThreadWork,
  };
}

export function createThreadLifecycleBundle(
  host: ChatPanelThreadHost,
  input: ChatPanelThreadLifecycleInput,
): ChatPanelThreadLifecycleBundle {
  const { appServer, localItemIds, ensureConnected, status, threadStart, foundation, notifyActiveThreadIdentityChanged } = input;
  const lifecycle = createSessionThreadLifecycle(host, {
    appServer,
    ensureConnected,
    status,
    goalSync: foundation.goalSync,
    autoTitleCoordinator: foundation.autoTitleCoordinator,
    history: foundation.history,
    invalidateThreadWork: () => {
      foundation.invalidateActiveThreadWork();
    },
    notifyActiveThreadIdentityChanged,
  });
  const goalEditor = createGoalEditorActions({ stateStore: host.stateStore });
  const goalCommands = createGoalCommands(
    {
      stateStore: host.stateStore,
      effects: appServer.threadGoal,
      ensureConnected: async () => {
        await ensureConnected();
        return appServer.connectionAvailable();
      },
      localItemIds,
      startThread: (preview, options) => threadStart.startThread(preview, options),
      ensureRestoredThreadLoaded: () =>
        lifecycle.restoration.ensureLoaded(async (threadId) => {
          await lifecycle.resume.resumeThread(threadId);
        }),
      startEditingGoal: goalEditor.startEditing,
      addSystemMessage: (text) => {
        status.addSystemMessage(text);
      },
      addGoalEvent: (item) => {
        host.stateStore.dispatch({ type: "thread-stream/item-upserted", item });
      },
    },
    foundation.goalCoordinator,
  );
  const goals: ChatPanelGoalCommands = { ...goalCommands, ...goalEditor };
  const rename = createThreadRenameEditorActions({
    stateStore: host.stateStore,
    threadById: (threadId) => host.environment.plugin.threadCatalog.activeThreadsSnapshot()?.find((item) => item.id === threadId),
    ensureConnected,
    addSystemMessage: status.addSystemMessage,
    renameThread: (threadId, value) => foundation.threadMutations.renameThread(threadId, value),
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

export function createThreadCommandBundle(host: ChatPanelThreadHost, input: ChatPanelThreadCommandInput): ChatPanelThreadCommandBundle {
  const { appServer, ensureConnected, status, composerController, foundation, lifecycle } = input;
  const { environment, stateStore } = host;
  const threadCommandsHost: ThreadCommandsHost = {
    stateStore,
    mutations: {
      renameThread: (threadId, value) => foundation.threadMutations.renameThread(threadId, value),
      setThreadPinned: (threadId, isPinned) => foundation.threadMutations.setThreadPinned(threadId, isPinned),
      archiveThread: async (threadId, options) => {
        await foundation.threadMutations.archiveThread(threadId, options);
        return true;
      },
    },
    effects: appServer.threadCommands,
    ensureConnected: async () => {
      await ensureConnected();
      return appServer.connectionAvailable();
    },
    addSystemMessage: status.addSystemMessage,
    setStatus: status.set,
    setComposerText: (text) => {
      composerController.setDraft(text, { focus: true });
    },
    openThreadInNewView: (threadId) => environment.plugin.workspace.openThreadInNewView(threadId),
    openThreadInCurrentPanel: async (threadId, onAdopted, beforeActivate) => {
      const adoption = { completed: false };
      await lifecycle.resume.resumeThread(threadId, undefined, {
        ...(beforeActivate ? { beforeActivate } : {}),
        onAdopted: () => {
          adoption.completed = true;
          onAdopted();
        },
      });
      if (adoption.completed) return { adopted: true };
      return { adopted: false };
    },
    applyThreadFact: (fact) => {
      environment.plugin.threadFacts.apply(fact);
    },
    threadPanelIsBusy: (threadId) => environment.plugin.workspace.threadPanelIsBusy(threadId),
  };
  const commands = createThreadCommands(threadCommandsHost);
  const toolbarPanelActions = createToolbarPanelActions({
    stateStore,
    threadCommands: commands,
  });
  const navigation = createThreadNavigationCommands({
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
  return { commands, toolbarPanelActions, navigation };
}

function createSessionThreadLifecycle(
  host: ChatPanelThreadHost,
  input: {
    appServer: ChatAppServerGateway;
    ensureConnected: () => Promise<void>;
    status: ChatPanelThreadStatus;
    goalSync: ChatPanelGoalSync;
    autoTitleCoordinator: AutoTitleCoordinator;
    history: HistoryController;
    invalidateThreadWork: () => void;
    notifyActiveThreadIdentityChanged: () => void;
  },
): ChatPanelThreadLifecycle {
  const {
    appServer,
    ensureConnected,
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
  const resume = createResumeCommand({
    stateStore: host.stateStore,
    effects: appServer.threadResume,
    ensureConnected: async () => {
      await ensureConnected();
      return appServer.connectionAvailable();
    },
    resumeWork: host.resumeWork,
    history,
    closing: host.getClosing,
    resetThreadTurnPresence,
    notifyActiveThreadIdentityChanged,
    recordResumedThread: (thread) => {
      host.environment.plugin.threadFacts.apply({ type: "thread-upserted", thread });
    },
    addSystemMessage: status.addSystemMessage,
    syncThreadGoal: (threadId) => goalSync.syncThreadGoal(threadId),
    focusThreadInOpenView: (threadId) => host.environment.plugin.workspace.focusThreadInOpenView(threadId),
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
