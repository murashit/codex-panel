import { Notice } from "obsidian";
import type { ThreadGoalCoordinator } from "../../../../domain/threads/goal-coordination";
import type { ThreadMutationCommands } from "../../../threads/workflows/thread-mutation-commands";
import { createThreadTitleService, type ThreadTitleService } from "../../../threads/workflows/thread-title-service";
import { recoverRolloutTokenUsage } from "../../app-server/mappers/rollout-token-usage";
import type { ChatAppServerGateway } from "../../app-server/session-gateway";
import type { LocalIdSource } from "../../application/local-id-source";
import { activeThreadId } from "../../application/state/model";
import type { ChatStateStore } from "../../application/state/store";
import { threadStreamItems } from "../../application/state/thread-stream";
import { chatThreadStreamViewState } from "../../application/state/turn-scope";
import { type ActiveThreadIdentitySync, createActiveThreadIdentitySync } from "../../application/threads/active-thread-identity-sync";
import { type AutoTitleCoordinator, createAutoTitleCoordinator } from "../../application/threads/auto-title-coordinator";
import type { ForkDisplaySnapshot } from "../../application/threads/fork-display-snapshot";
import { createGoalCommands, type GoalCommands } from "../../application/threads/goal-commands";
import { createGoalEditorActions, type GoalEditorActions } from "../../application/threads/goal-editor-actions";
import { createThreadGoalSync, type ThreadGoalSync } from "../../application/threads/goal-sync";
import { HistoryController } from "../../application/threads/history-controller";
import type { PersistentNavigationLifecycle } from "../../application/threads/persistent-navigation-lifecycle";
import { RestorationController } from "../../application/threads/restoration-controller";
import { createResumeCommand, type ResumeCommand } from "../../application/threads/resume-command";
import type { ChatResumeWorkTracker } from "../../application/threads/resume-work";
import { createThreadCommands, type ThreadCommandsHost } from "../../application/threads/thread-commands";
import { createThreadNavigationCommands } from "../../application/threads/thread-navigation-commands";
import type { ThreadStartCommand } from "../../application/threads/thread-start-command";
import { threadTitleContextFromThreadStreamItems } from "../../application/threads/title-context";
import type { ChatComposerController } from "../composer/controller";
import type { ChatPanelEnvironment } from "../contracts";
import { createToolbarPanelActions, type ToolbarPanelActions } from "../toolbar/actions";
import { activeThreadRenameTitleContext, createThreadRenameEditorActions, type ThreadRenameEditorActions } from "./rename-editor";

type SessionGoalSync = ThreadGoalSync;
export type SessionGoalCommands = GoalCommands & GoalEditorActions;
export type SessionThreadCommands = ReturnType<typeof createThreadCommands>;
export type SessionThreadNavigationCommands = ReturnType<typeof createThreadNavigationCommands>;

export interface SessionThreadLifecycle {
  restoration: RestorationController;
  resume: ResumeCommand;
  identity: ActiveThreadIdentitySync;
  ensureRestoredThreadLoaded: (displaySnapshot?: ForkDisplaySnapshot) => Promise<boolean>;
}

interface SessionThreadStatus {
  set: (statusText: string) => void;
  addSystemMessage: (text: string) => void;
}

interface SessionThreadHost {
  environment: ChatPanelEnvironment;
  stateStore: ChatStateStore;
  resumeWork: ChatResumeWorkTracker;
  threadStreamScrollBinding: {
    showLatest(): void;
  };
  getClosing: () => boolean;
}

interface SessionThreadFoundationInput {
  appServer: Pick<ChatAppServerGateway, "threadGoalRead" | "threadHistory">;
  localItemIds: LocalIdSource;
  status: SessionThreadStatus;
}

interface SessionThreadFoundation {
  titleService: ThreadTitleService;
  autoTitleCoordinator: AutoTitleCoordinator;
  history: HistoryController;
  goalSync: SessionGoalSync;
  goalCoordinator: ThreadGoalCoordinator;
  threadMutations: ThreadMutationCommands;
  invalidateActiveThreadWork(): void;
}

interface SessionThreadFeaturesInput {
  appServer: ChatAppServerGateway;
  localItemIds: LocalIdSource;
  ensureConnected: () => Promise<void>;
  status: SessionThreadStatus;
  threadStart: ThreadStartCommand;
  foundation: SessionThreadFoundation;
  notifyActiveThreadIdentityChanged: () => void;
}

interface SessionThreadFeatures extends SessionThreadLifecycle {
  goals: SessionGoalCommands;
  rename: ThreadRenameEditorActions;
}

interface SessionThreadCommandInput {
  appServer: ChatAppServerGateway;
  ensureConnected: () => Promise<void>;
  status: SessionThreadStatus;
  composerController: ChatComposerController;
  foundation: SessionThreadFoundation;
  features: SessionThreadFeatures;
  navigation: PersistentNavigationLifecycle;
  activatePersistentThread: (threadId: string, displaySnapshot?: ForkDisplaySnapshot) => Promise<void>;
}

interface SessionThreadCommandsResult {
  commands: SessionThreadCommands;
  toolbarPanelActions: ToolbarPanelActions;
  navigation: SessionThreadNavigationCommands;
}

export function createSessionThreadFoundation(host: SessionThreadHost, input: SessionThreadFoundationInput): SessionThreadFoundation {
  const { appServer, localItemIds, status } = input;
  const { environment, stateStore } = host;
  const titleService = createThreadTitleService({
    port: environment.plugin.threadTitlePort,
    visibleContext: (threadId) => activeThreadRenameTitleContext(stateStore.getState(), threadId),
    visibleCompletedTurnContext: (turnId) => {
      const state = stateStore.getState();
      return threadTitleContextFromThreadStreamItems(
        turnId,
        threadStreamItems(chatThreadStreamViewState(state.threadStream, state.activeTurn)),
      );
    },
  });
  const threadMutations = environment.plugin.threadMutations;
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

export function createSessionThreadFeatures(host: SessionThreadHost, input: SessionThreadFeaturesInput): SessionThreadFeatures {
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
      ensureRestoredThreadLoaded: lifecycle.ensureRestoredThreadLoaded,
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
  const goals: SessionGoalCommands = { ...goalCommands, ...goalEditor };
  const rename = createThreadRenameEditorActions({
    stateStore: host.stateStore,
    threadById: (threadId) => host.environment.plugin.threadCatalog.activeThreadsSnapshot()?.find((item) => item.id === threadId),
    ensureConnected,
    addSystemMessage: status.addSystemMessage,
    renameThread: (threadId, value) => foundation.threadMutations.renameThread(threadId, value),
    resolveThreadTitleContext: (threadId) => foundation.titleService.resolveContext(threadId),
    generateThreadTitle: (context, signal) => foundation.titleService.generate(context, signal),
  });
  const { identity, restoration, resume, ensureRestoredThreadLoaded } = lifecycle;

  return {
    goals,
    rename,
    identity,
    restoration,
    resume,
    ensureRestoredThreadLoaded,
  };
}

export function createSessionThreadCommands(host: SessionThreadHost, input: SessionThreadCommandInput): SessionThreadCommandsResult {
  const { appServer, ensureConnected, status, composerController, foundation, features } = input;
  const { environment, stateStore } = host;
  const threadCommandsHost: ThreadCommandsHost = {
    stateStore,
    mutations: {
      renameThread: (threadId, value) => foundation.threadMutations.renameThread(threadId, value),
      setThreadPinned: (threadId, isPinned) => foundation.threadMutations.setThreadPinned(threadId, isPinned),
      archiveThread: async (threadId, options) => {
        const result = await foundation.threadMutations.archiveThread(threadId, options);
        if (result.kind === "blocked") {
          status.addSystemMessage("Finish or interrupt the thread before archiving it.");
          return false;
        }
        if (result.exportedPath) new Notice(`Saved archived thread to ${result.exportedPath}.`);
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
    openThreadInNewView: (threadId, displaySnapshot) => environment.plugin.workspace.openThreadInNewView(threadId, displaySnapshot),
    openThreadInCurrentPanel: async (threadId, displaySnapshot) => {
      await input.activatePersistentThread(threadId, displaySnapshot);
      return activeThreadId(stateStore.getState()) === threadId;
    },
    beginThreadReplacementPublication: (sourceThreadId) => environment.plugin.threadReplacementPublication.begin(sourceThreadId),
    applyThreadFact: (fact) => {
      environment.plugin.threadFacts.apply(fact);
    },
  };
  const commands = createThreadCommands(threadCommandsHost);
  const toolbarPanelActions = createToolbarPanelActions({
    stateStore,
    threadCommands: commands,
  });
  const navigation = createThreadNavigationCommands({
    stateStore,
    identity: features.identity,
    closeForThreadSelection: () => {
      toolbarPanelActions.closeForThreadSelection();
    },
    openThreadFromPanel: (threadId, originSwitchable) =>
      environment.plugin.workspace.openThreadFromPanel(threadId, environment.obsidian.viewId, originSwitchable),
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
  host: SessionThreadHost,
  input: {
    appServer: ChatAppServerGateway;
    ensureConnected: () => Promise<void>;
    status: SessionThreadStatus;
    goalSync: SessionGoalSync;
    autoTitleCoordinator: AutoTitleCoordinator;
    history: HistoryController;
    invalidateThreadWork: () => void;
    notifyActiveThreadIdentityChanged: () => void;
  },
): SessionThreadLifecycle {
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
    ensureRestoredThreadLoaded: (displaySnapshot) =>
      restoration.ensureLoaded(async (threadId) => {
        const activation = await resume.resumeThread(threadId, undefined, displaySnapshot);
        await activation?.hydrate();
      }),
  };
}
