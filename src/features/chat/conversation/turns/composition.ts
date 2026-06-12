import type { App, Component } from "obsidian";

import type { AppServerClient } from "../../../../app-server/client";
import type { ChatServerThreadActions } from "../../protocol/client-actions/thread-actions";
import { ChatComposerController } from "../composer/controller";
import { activeTurnId, type ChatState, type ChatStateStore } from "../../state/reducer";
import type { ChatReconnectActions } from "../../connection/reconnect-actions";
import { PendingRequestController } from "../../pending-requests/controller";
import type { ChatRuntimeSettingsActions } from "../../runtime/runtime-settings-actions";
import { createComposerSubmissionActions } from "./composer-submission-actions";
import { createPlanImplementationActions } from "./plan-implementation-actions";
import { createSlashCommandActions } from "./slash-command-actions";
import { TurnSubmissionController } from "./turn-submission-controller";
import type { ChatThreadActions } from "../../threads/thread-actions";
import type { ChatThreadGoalActions } from "../../threads/thread-goal-actions";
import type { ThreadHistoryController } from "../../threads/thread-history-controller";
import type { ThreadRenameController } from "../../threads/thread-rename-controller";
import type { ChatInboundController } from "../../protocol/inbound/controller";
import { currentModel, runtimeConfigOrDefault } from "../../runtime/effective-settings";
import type { RuntimeSnapshot } from "../../runtime/model";
import { ChatMessageRenderer } from "../../ui/message-stream/renderer";
import type { DisplayDetailSection } from "../../display/types";
import type { ChatMessageScrollIntentController } from "../../ui/message-scroll-intent-controller";
import type { ChatTurnDiffViewState } from "../../turn-diff/model";
import type { ComposerMetaViewModel } from "../../ui/composer";
import type { CodexPanelSettings } from "../../../../settings/model";

interface ConversationSurfaceControllerGroupPorts {
  obsidian: {
    app: App;
    owner: Component;
    viewId: string;
  };
  plugin: {
    openTurnDiff: (state: ChatTurnDiffViewState) => Promise<void>;
    settings: CodexPanelSettings;
    vaultPath: string;
  };
  state: {
    stateStore: ChatStateStore;
    getState: () => ChatState;
  };
  client: {
    getClient: () => AppServerClient | null;
    ensureConnected: () => Promise<void>;
  };
  lifecycle: {
    messageScrollIntent: ChatMessageScrollIntentController;
  };
  render: {
    now: () => void;
    schedule: () => void;
  };
  messages: {
    pendingRequestsSignature: () => string;
  };
  composerView: {
    composerPlaceholder: () => string;
    composerMetaViewModel: () => ComposerMetaViewModel;
  };
  runtime: {
    runtimeSnapshotForState: (state: ChatState) => RuntimeSnapshot;
    statusSummaryLines: () => string[];
    connectionDiagnosticDetails: () => DisplayDetailSection[];
    mcpStatusLines: () => Promise<string[]>;
    modelStatusLines: () => string[];
    effortStatusLines: () => string[];
  };
  thread: {
    ensureRestoredThreadLoaded: () => Promise<boolean>;
    startNewThread: () => Promise<void>;
    selectThread: (threadId: string) => Promise<void>;
    notifyIdentityChanged: () => void;
    resetTurnPresence: (hadTurns: boolean) => void;
  };
  liveState: {
    refresh: () => void;
  };
  status: {
    set: (status: string) => void;
    addSystemMessage: (text: string) => void;
    addStructuredSystemMessage: (text: string, details: DisplayDetailSection[]) => void;
  };
  scroll: {
    forceBottom: () => void;
    followBottom: () => void;
  };
}

export function createConversationSurfaceControllerGroup(
  context: ConversationSurfaceControllerGroupPorts,
  refs: {
    controller: ChatInboundController;
    serverThreads: ChatServerThreadActions;
    runtimeSettings: ChatRuntimeSettingsActions;
    threadActions: ChatThreadActions;
    threadRename: ThreadRenameController;
    reconnectActions: ChatReconnectActions;
    goals: ChatThreadGoalActions;
    history: ThreadHistoryController;
  },
) {
  const { plugin, state, render, messages, composerView, runtime, thread, liveState, status, lifecycle, client, scroll } = context;
  const { app, owner, viewId } = context.obsidian;
  const stateStore = state.stateStore;
  const currentClient = client.getClient;
  const { messageScrollIntent } = lifecycle;

  const composerController = new ChatComposerController({
    app,
    stateStore,
    viewId,
    sendShortcut: () => plugin.settings.sendShortcut,
    scrollThreadFromComposerEdges: () => plugin.settings.scrollThreadFromComposerEdges,
    canInterrupt: () => {
      const current = state.getState();
      return current.turn.lifecycle.kind !== "idle" && Boolean(current.activeThread.id && activeTurnId(current));
    },
    composerPlaceholder: composerView.composerPlaceholder,
    composerMeta: composerView.composerMetaViewModel,
    currentModelForSuggestions: () => {
      const current = state.getState();
      return currentModel(runtime.runtimeSnapshotForState(current), runtimeConfigOrDefault(current.connection.runtimeConfig));
    },
    togglePlan: () => void refs.runtimeSettings.toggleCollaborationMode(),
    toggleAutoReview: () => void refs.runtimeSettings.toggleAutoReview(),
    toggleFast: () => void refs.runtimeSettings.toggleFastMode(),
    onDraftChange: liveState.refresh,
    onHeightChange: () => {
      messageRenderer.repinMessagesToBottomIfPinned();
    },
  });
  const pendingRequests = new PendingRequestController({
    stateStore,
    controller: refs.controller,
    composerHasFocus: () => composerController.hasFocus(),
    refreshLiveState: liveState.refresh,
    render: render.now,
  });

  const turnSubmission = new TurnSubmissionController({
    stateStore,
    connection: {
      vaultPath: plugin.vaultPath,
      currentClient,
    },
    restoredThread: {
      ensureRestoredThreadLoaded: thread.ensureRestoredThreadLoaded,
    },
    thread: {
      startThread: (preview) => refs.serverThreads.startThread(preview),
      notifyActiveThreadIdentityChanged: thread.notifyIdentityChanged,
      resetThreadTurnPresence: thread.resetTurnPresence,
    },
    runtime: {
      applyPendingThreadSettings: () => refs.runtimeSettings.applyPendingThreadSettings(),
    },
    composer: {
      codexInput: (text) => composerController.codexInput(text),
      setDraft: (text, options) => {
        composerController.setDraft(text, options);
      },
    },
    view: {
      render: render.now,
      scheduleRender: render.schedule,
    },
    status: {
      setStatus: status.set,
      addSystemMessage: status.addSystemMessage,
    },
  });
  const slashCommands = createSlashCommandActions({
    stateStore,
    currentClient,
    codexInput: (text) => composerController.codexInput(text),
    threads: {
      startNewThread: thread.startNewThread,
      startThreadForGoal: async (objective) => {
        const response = await refs.serverThreads.startThread(objective, { syncGoal: false });
        return response?.threadId ?? null;
      },
      resumeThread: thread.selectThread,
      forkThread: (threadId) => refs.threadActions.forkThread(threadId),
      rollbackThread: (threadId) => refs.threadActions.rollbackThread(threadId),
      compactThread: (threadId) => refs.threadActions.compactThread(threadId),
      archiveThread: (threadId) => refs.threadActions.archiveThread(threadId),
      renameThread: (threadId, name) => refs.threadRename.rename(threadId, name),
      reconnect: () => refs.reconnectActions.reconnectPanel(),
    },
    runtime: {
      toggleFastMode: () => refs.runtimeSettings.toggleFastMode(),
      toggleCollaborationMode: () => refs.runtimeSettings.toggleCollaborationMode(),
      toggleAutoReview: () => void refs.runtimeSettings.toggleAutoReview(),
      requestModel: (model) => refs.runtimeSettings.requestModel(model),
      resetModelToConfig: () => refs.runtimeSettings.resetModelToConfig(),
      requestReasoningEffort: (effort) => refs.runtimeSettings.requestReasoningEffort(effort),
      resetReasoningEffortToConfig: () => refs.runtimeSettings.resetReasoningEffortToConfig(),
    },
    goals: {
      activeGoal: () => refs.goals.activeGoal(),
      setObjective: (threadId, objective, tokenBudget) => refs.goals.setObjective(threadId, objective, tokenBudget),
      setStatus: (threadId, goalStatus) => refs.goals.setStatus(threadId, goalStatus),
      clear: (threadId) => refs.goals.clear(threadId),
    },
    status: {
      addSystemMessage: status.addSystemMessage,
      addStructuredSystemMessage: status.addStructuredSystemMessage,
      setStatus: status.set,
      statusSummaryLines: runtime.statusSummaryLines,
      connectionDiagnosticDetails: runtime.connectionDiagnosticDetails,
      mcpStatusLines: runtime.mcpStatusLines,
      modelStatusLines: runtime.modelStatusLines,
      effortStatusLines: runtime.effortStatusLines,
    },
  });
  const planImplementation = createPlanImplementationActions({
    stateStore,
    connection: {
      currentClient,
      ensureConnected: client.ensureConnected,
    },
    submission: {
      sendTurnText: (text) => turnSubmission.sendTurnText(text),
    },
    runtime: {
      requestDefaultCollaborationModeForNextTurn: () => {
        refs.runtimeSettings.requestDefaultCollaborationModeForNextTurn();
      },
    },
  });

  const messageRenderer = new ChatMessageRenderer({
    obsidian: {
      app,
      owner,
    },
    state: {
      store: stateStore,
    },
    workspace: {
      vaultPath: plugin.vaultPath,
    },
    scroll: {
      consumeIntent: () => messageScrollIntent.consumeIntent(),
    },
    history: {
      loadOlderTurns: () => void refs.history.loadOlder(),
    },
    actions: {
      rollbackThread: (threadId) => void refs.threadActions.rollbackThread(threadId),
      forkThreadFromTurn: (threadId, turnId, archiveSource) => void refs.threadActions.forkThreadFromTurn(threadId, turnId, archiveSource),
      implementPlan: (item) => void planImplementation.implement(item),
      openTurnDiff: (state) => void plugin.openTurnDiff(state),
    },
    requests: {
      pendingSignature: messages.pendingRequestsSignature,
      pendingSnapshot: () => pendingRequests.snapshot(),
      pendingActions: () => pendingRequests.actions(),
      consumePendingAutoFocus: () => pendingRequests.consumeAutoFocus(),
    },
  });
  const composerSubmission = createComposerSubmissionActions({
    stateStore,
    composer: composerController,
    slashCommands,
    turnSubmission,
    connection: {
      currentClient,
      ensureConnected: client.ensureConnected,
    },
    status: {
      setStatus: status.set,
      addSystemMessage: status.addSystemMessage,
    },
    scroll: {
      followBottom: scroll.followBottom,
    },
  });
  composerController.setActionHandlers({
    submit: () => void composerSubmission.submit(),
    threadScrollFromComposer: (action) => {
      messageRenderer.scrollFromComposer(action);
    },
  });

  return {
    pendingRequests,
    messageRenderer,
    composerController,
    composerSubmission,
  };
}
