import { Notice } from "obsidian";
import type { ThreadMutationCommands } from "../../../threads/workflows/thread-mutation-commands";
import { recoverRolloutTokenUsage } from "../../app-server/mappers/rollout-token-usage";
import type { ChatAppServerGateway } from "../../app-server/session-gateway";
import type { ChatStateStore } from "../../application/state/store";
import { threadStreamItems } from "../../application/state/thread-stream";
import { chatThreadStreamViewState } from "../../application/state/turn-scope";
import { ThreadActivation } from "../../application/threads/activation";
import { type ActiveThreadIdentitySync, createActiveThreadIdentitySync } from "../../application/threads/active-thread-identity-sync";
import { type AutoTitleCoordinator, createAutoTitleCoordinator } from "../../application/threads/auto-title-coordinator";
import type { ForkDisplaySnapshot } from "../../application/threads/fork-display-snapshot";
import type { ForkDraftPreparation } from "../../application/threads/fork-draft";
import { createGoalCommands, type GoalCommands } from "../../application/threads/goal-commands";
import { HistoryController } from "../../application/threads/history-controller";
import { createThreadCommands, type ThreadCommands, type ThreadCommandsHost } from "../../application/threads/thread-commands";
import { createThreadNavigationCommands, type ThreadNavigationCommands } from "../../application/threads/thread-navigation-commands";
import type { ThreadStartCommand } from "../../application/threads/thread-start-command";
import { completedTurnTitleContext } from "../../application/threads/title-context";
import type { ChatComposerController } from "../composer/controller";
import type { ChatPanelEnvironment } from "../contracts";
import { createToolbarPanelActions, type ToolbarPanelActions } from "../toolbar/actions";
import { activeThreadRenameTitleContext, createThreadRenameEditorActions, type ThreadRenameEditorActions } from "./rename-editor";

export interface SessionThreadLifecycle {
  activation: ThreadActivation;
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
  threadStreamScrollBinding: {
    showLatest(): void;
  };
  getClosing: () => boolean;
}

interface SessionThreadFoundationInput {
  appServer: Pick<ChatAppServerGateway, "threadHistory">;
  status: SessionThreadStatus;
}

interface SessionThreadFoundation {
  autoTitleCoordinator: AutoTitleCoordinator;
  history: HistoryController;
  threadMutations: ThreadMutationCommands;
}

interface SessionThreadFeaturesInput {
  appServer: ChatAppServerGateway;
  ensureConnected: () => Promise<void>;
  status: SessionThreadStatus;
  threadStart: ThreadStartCommand;
  withThreadActivation: <T>(threadId: string, operation: () => Promise<T>) => Promise<T>;
  foundation: SessionThreadFoundation;
  notifyActiveThreadIdentityChanged: () => void;
}

interface SessionThreadFeatures extends SessionThreadLifecycle {
  invalidateActiveThreadWork(): void;
  goals: GoalCommands;
  rename: ThreadRenameEditorActions;
}

interface SessionThreadCommandInput {
  applyForkDraft: (preparation: ForkDraftPreparation) => Promise<void>;
  appServer: ChatAppServerGateway;
  ensureConnected: () => Promise<void>;
  status: SessionThreadStatus;
  composerController: Pick<ChatComposerController, "focusComposer">;
  foundation: SessionThreadFoundation;
  features: SessionThreadFeatures;
}

interface SessionThreadCommandsResult {
  commands: ThreadCommands;
  toolbarPanelActions: ToolbarPanelActions;
  navigation: ThreadNavigationCommands;
}

export function createSessionThreadFoundation(host: SessionThreadHost, input: SessionThreadFoundationInput): SessionThreadFoundation {
  const { appServer, status } = input;
  const { environment, stateStore } = host;
  const threadMutations = environment.plugin.threadMutations;
  const autoTitleCoordinator = createAutoTitleCoordinator({
    threadById: (threadId) => environment.plugin.threadCatalog.activeThreadsSnapshot()?.find((item) => item.id === threadId),
    completedTurnTitleContext: (turnId, summary) => {
      const state = stateStore.getState();
      return completedTurnTitleContext(turnId, threadStreamItems(chatThreadStreamViewState(state.threadStream, state.activeTurn)), summary);
    },
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
  return {
    autoTitleCoordinator,
    history,
    threadMutations,
  };
}

export function createSessionThreadFeatures(host: SessionThreadHost, input: SessionThreadFeaturesInput): SessionThreadFeatures {
  const { appServer, ensureConnected, status, threadStart, foundation, notifyActiveThreadIdentityChanged } = input;
  const rename = createThreadRenameEditorActions({
    stateStore: host.stateStore,
    threadById: (threadId) => host.environment.plugin.threadCatalog.activeThreadsSnapshot()?.find((item) => item.id === threadId),
    ensureConnected,
    addSystemMessage: status.addSystemMessage,
    renameThread: foundation.threadMutations.renameThread,
    resolveThreadTitleContext: async (threadId) =>
      activeThreadRenameTitleContext(host.stateStore.getState(), threadId) ??
      host.environment.plugin.threadTitlePort.persistedContext(threadId),
    generateThreadTitle: (context, signal) => host.environment.plugin.threadTitlePort.generateTitle(context, signal),
  });
  const invalidateActiveThreadWork = (): void => {
    foundation.history.invalidate();
    lifecycle.activation.invalidate();
    rename.cancelGenerations();
  };
  const lifecycle = createSessionThreadLifecycle(host, {
    appServer,
    ensureConnected,
    status,
    autoTitleCoordinator: foundation.autoTitleCoordinator,
    history: foundation.history,
    invalidateThreadWork: invalidateActiveThreadWork,
    notifyActiveThreadIdentityChanged,
    withThreadActivation: input.withThreadActivation,
  });
  const goals = createGoalCommands({
    stateStore: host.stateStore,
    effects: appServer.threadGoal,
    goalQueries: host.environment.plugin.threadGoalQueries,
    ensureConnected: async () => {
      await ensureConnected();
      return appServer.connectionAvailable();
    },
    startThread: threadStart.startThread,
    ensureRestoredThreadLoaded: lifecycle.ensureRestoredThreadLoaded,
    addSystemMessage: (text) => {
      status.addSystemMessage(text);
    },
  });
  const { identity, activation, ensureRestoredThreadLoaded } = lifecycle;

  return {
    goals,
    rename,
    invalidateActiveThreadWork,
    identity,
    activation,
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
        if (result.exportedPath) new Notice(`Saved thread to ${result.exportedPath}.`);
        if (result.kind !== "archived") {
          status.addSystemMessage(result.kind === "blocked" ? "Finish or interrupt the thread before archiving it." : result.message);
          return false;
        }
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
    openForkDraft: async (preparation, inNewPanel) => {
      if (inNewPanel) {
        await environment.plugin.workspace.openForkDraft(preparation);
        return;
      }
      await input.applyForkDraft(preparation);
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
    addSystemMessage: status.addSystemMessage,
    focusComposer: () => {
      composerController.focusComposer();
    },
  });
  return { commands, toolbarPanelActions, navigation };
}

function createSessionThreadLifecycle(
  host: SessionThreadHost,
  input: {
    appServer: ChatAppServerGateway;
    ensureConnected: () => Promise<void>;
    status: SessionThreadStatus;
    autoTitleCoordinator: AutoTitleCoordinator;
    history: HistoryController;
    invalidateThreadWork: () => void;
    notifyActiveThreadIdentityChanged: () => void;
    withThreadActivation: <T>(threadId: string, operation: () => Promise<T>) => Promise<T>;
  },
): SessionThreadLifecycle {
  const { appServer, ensureConnected, status, autoTitleCoordinator, history, invalidateThreadWork, notifyActiveThreadIdentityChanged } =
    input;
  const resetThreadTurnPresence = (hadTurns: boolean) => {
    autoTitleCoordinator.resetThreadTurnPresence(hadTurns);
  };
  const activation = new ThreadActivation({
    withThreadActivation: input.withThreadActivation,
    stateStore: host.stateStore,
    effects: appServer.threadResume,
    ensureConnected: async () => {
      await ensureConnected();
      return appServer.connectionAvailable();
    },
    history,
    closing: host.getClosing,
    resetThreadTurnPresence,
    notifyActiveThreadIdentityChanged,
    recordResumedThread: (thread) => {
      host.environment.plugin.threadFacts.apply({ type: "thread-upserted", thread });
    },
    addSystemMessage: status.addSystemMessage,
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
    activation,
    identity,
    ensureRestoredThreadLoaded: (displaySnapshot) => activation.ensureRestoredThreadLoaded(displaySnapshot),
  };
}
