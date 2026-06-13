import type { ChatServerThreadActions } from "../connection/server-actions/threads";
import { ChatComposerController } from "./composer/controller";
import { activeTurnId } from "../state/reducer";
import type { ChatReconnectActions } from "../connection/reconnect-actions";
import { PendingRequestController } from "./pending-requests/controller";
import type { ChatRuntimeSettingsActions } from "../runtime/settings-actions";
import { createComposerSubmitActions } from "./turns/composer-submit-actions";
import { createPlanImplementation } from "./turns/plan-implementation";
import { createSlashCommandHandler } from "./turns/slash-command-handler";
import { TurnSubmissionController } from "./turns/turn-submission-controller";
import type { ChatThreadActions } from "../threads/action-context";
import type { GoalActions } from "../threads/goal-actions";
import type { HistoryController } from "../threads/history-controller";
import type { ChatInboundController } from "../protocol/inbound/controller";
import { currentModel, runtimeConfigOrDefault } from "../runtime/effective";
import { runtimeSnapshotForChatState } from "../runtime/snapshot";
import { MessageStreamRenderer } from "../panel/surface/message-stream-renderer";
import type { ChatControllerPorts } from "../controller-ports";
import type { DisplayDetailSection } from "../display/types";

type ConversationSurfaceControllerGroupPorts = Pick<
  ChatControllerPorts,
  "obsidian" | "plugin" | "state" | "lifecycle" | "surface" | "runtime" | "liveState"
> & {
  client: {
    getClient: ChatControllerPorts["client"]["getClient"];
    ensureConnected: () => Promise<void>;
  };
  render: {
    now: () => void;
    schedule: () => void;
  };
  status: {
    set: (status: string) => void;
    addSystemMessage: (text: string) => void;
    addStructuredSystemMessage: (text: string, details: DisplayDetailSection[]) => void;
  };
  scroll: Pick<ChatControllerPorts["scroll"], "forceBottom" | "followBottom">;
  thread: {
    ensureRestoredThreadLoaded: ChatControllerPorts["thread"]["ensureRestoredThreadLoaded"];
    startNewThread: ChatControllerPorts["thread"]["startNewThread"];
    selectThread: (threadId: string) => Promise<void>;
    notifyIdentityChanged: () => void;
    resetTurnPresence: (hadTurns: boolean) => void;
  };
  runtime: ChatControllerPorts["runtime"] & {
    mcpStatusLines: () => Promise<string[]>;
  };
};

export function createConversationSurfaceControllerGroup(
  context: ConversationSurfaceControllerGroupPorts,
  refs: {
    controller: ChatInboundController;
    serverThreads: ChatServerThreadActions;
    runtimeSettings: ChatRuntimeSettingsActions;
    threadActions: ChatThreadActions;
    reconnectActions: ChatReconnectActions;
    goals: GoalActions;
    history: HistoryController;
  },
) {
  const { plugin, state, render, surface, runtime, thread, liveState, status, lifecycle, client, scroll } = context;
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
    canInterrupt: (state) => {
      return state.turn.lifecycle.kind !== "idle" && Boolean(state.activeThread.id && activeTurnId(state));
    },
    composerPlaceholder: surface.composerPlaceholder,
    composerMeta: surface.composerMetaViewModel,
    currentModelForSuggestions: () => {
      const current = stateStore.getState();
      return currentModel(runtimeSnapshotForChatState(current), runtimeConfigOrDefault(current.connection.runtimeConfig));
    },
    togglePlan: () => void refs.runtimeSettings.toggleCollaborationMode(),
    toggleAutoReview: () => void refs.runtimeSettings.toggleAutoReview(),
    toggleFast: () => void refs.runtimeSettings.toggleFastMode(),
    onDraftChange: liveState.refresh,
    onHeightChange: () => {
      messageStreamRenderer.repinMessageStreamToBottomIfPinned();
    },
  });
  const codexInput = (text: string) => composerController.codexInput(text);
  const setComposerDraft = (text: string, options?: { focus?: boolean; clearSuggestions?: boolean }) => {
    composerController.setDraft(text, options);
  };
  const startThread = (preview?: string) => refs.serverThreads.startThread(preview);
  const startThreadForGoal = async (objective: string) => {
    const response = await refs.serverThreads.startThread(objective, { syncGoal: false });
    return response?.threadId ?? null;
  };

  const pendingRequests = new PendingRequestController({
    stateStore,
    controller: refs.controller,
    composerHasFocus: () => composerController.hasFocus(),
    refreshLiveState: liveState.refresh,
    render: render.now,
  });

  const turnSubmission = new TurnSubmissionController({
    stateStore,
    vaultPath: plugin.vaultPath,
    currentClient,
    ensureRestoredThreadLoaded: thread.ensureRestoredThreadLoaded,
    startThread,
    notifyActiveThreadIdentityChanged: thread.notifyIdentityChanged,
    resetThreadTurnPresence: thread.resetTurnPresence,
    applyPendingThreadSettings: () => refs.runtimeSettings.applyPendingThreadSettings(),
    codexInput,
    setDraft: setComposerDraft,
    render: render.now,
    scheduleRender: render.schedule,
    setStatus: status.set,
    addSystemMessage: status.addSystemMessage,
  });
  const slashCommands = createSlashCommandHandler({
    stateStore,
    currentClient,
    codexInput,
    startNewThread: thread.startNewThread,
    startThreadForGoal,
    resumeThread: thread.selectThread,
    forkThread: (threadId) => refs.threadActions.forkThread(threadId),
    rollbackThread: (threadId) => refs.threadActions.rollbackThread(threadId),
    compactThread: (threadId) => refs.threadActions.compactThread(threadId),
    archiveThread: (threadId) => refs.threadActions.archiveThread(threadId),
    renameThread: (threadId, name) => refs.threadActions.renameThread(threadId, name).then(() => undefined),
    reconnect: () => refs.reconnectActions.reconnectPanel(),
    toggleFastMode: () => refs.runtimeSettings.toggleFastMode(),
    toggleCollaborationMode: () => refs.runtimeSettings.toggleCollaborationMode(),
    toggleAutoReview: () => void refs.runtimeSettings.toggleAutoReview(),
    requestModel: (model) => refs.runtimeSettings.requestModel(model),
    resetModelToConfig: () => refs.runtimeSettings.resetModelToConfig(),
    requestReasoningEffort: (effort) => refs.runtimeSettings.requestReasoningEffort(effort),
    resetReasoningEffortToConfig: () => refs.runtimeSettings.resetReasoningEffortToConfig(),
    activeGoal: () => refs.goals.activeGoal(),
    setGoalObjective: (threadId, objective, tokenBudget) => refs.goals.setObjective(threadId, objective, tokenBudget),
    setGoalStatus: (threadId, goalStatus) => refs.goals.setStatus(threadId, goalStatus),
    clearGoal: (threadId) => refs.goals.clear(threadId),
    addSystemMessage: status.addSystemMessage,
    addStructuredSystemMessage: status.addStructuredSystemMessage,
    setStatus: status.set,
    statusSummaryLines: runtime.statusSummaryLines,
    connectionDiagnosticDetails: runtime.connectionDiagnosticDetails,
    mcpStatusLines: runtime.mcpStatusLines,
    modelStatusLines: runtime.modelStatusLines,
    effortStatusLines: runtime.effortStatusLines,
  });
  const planImplementation = createPlanImplementation({
    stateStore,
    currentClient,
    ensureConnected: client.ensureConnected,
    sendTurnText: (text) => turnSubmission.sendTurnText(text),
    requestDefaultCollaborationModeForNextTurn: () => {
      refs.runtimeSettings.requestDefaultCollaborationModeForNextTurn();
    },
  });

  const messageStreamRenderer = new MessageStreamRenderer({
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
      pendingSignature: surface.pendingRequestsSignature,
      pendingSnapshot: () => pendingRequests.snapshot(),
      pendingActions: () => pendingRequests.actions(),
      consumePendingAutoFocus: () => pendingRequests.consumeAutoFocus(),
    },
  });
  const composerSubmit = createComposerSubmitActions({
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
    submit: () => void composerSubmit.submit(),
    threadScrollFromComposer: (action) => {
      messageStreamRenderer.scrollFromComposer(action);
    },
  });

  return {
    pendingRequests,
    messageStreamRenderer,
    composerController,
    composerSubmit,
  };
}
