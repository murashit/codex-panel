import type { ChatState } from "../state/reducer";
import { pendingRequestsSignature as requestStateSignature } from "../pending-requests/view-model";
import {
  activeComposerThreadName as buildActiveComposerThreadName,
  composerMetaViewModel as buildComposerMetaViewModel,
  composerPlaceholder as buildComposerPlaceholder,
  runtimeComposerChoices,
  toolbarViewModel as buildToolbarViewModel,
} from "../panel/view-model";
import type { GoalBannerActions, GoalBannerOptions } from "./goal-banner";
import type { ChatPanelComposerPorts, ChatPanelGoalPorts, ChatPanelMessagesPorts, ChatPanelToolbarPorts } from "../panel/ui-ports";
import type { ChatPanelShellState } from "./shell";

export function chatPanelToolbarViewModel(ports: ChatPanelToolbarPorts, shellState: ChatPanelShellState) {
  return buildToolbarViewModel({
    state: chatStateWithSlices(shellState, {
      connection: shellState.connection.value,
      threadList: shellState.threadList.value,
      activeThread: shellState.activeThread.value,
      runtime: shellState.runtime.value,
      turn: shellState.turn.value,
      ui: shellState.ui.value,
    }),
    snapshot: ports.runtime.snapshot(),
    connected: ports.state.connected(),
    turnBusy: ports.state.turnBusy(),
    vaultPath: ports.settings.vaultPath(),
    configuredCommand: ports.settings.configuredCommand(),
    archiveConfirmThreadId: ports.view.toolbar.archiveConfirmId(),
    archiveExportEnabled: ports.settings.archiveExportEnabled(),
    renameState: (threadId) => ports.view.toolbar.renameState(threadId),
  });
}

export function chatPanelGoalProps(
  ports: ChatPanelGoalPorts,
  state: ReturnType<ChatPanelGoalPorts["state"]["chat"]>,
): {
  goal: ReturnType<ChatPanelGoalPorts["state"]["chat"]>["activeThread"]["goal"];
  actions: GoalBannerActions;
  options: GoalBannerOptions;
} {
  return {
    goal: state.activeThread.goal,
    actions: {
      onSave: (objective, tokenBudget) => {
        void ports.actions.goal.saveObjective(objective, tokenBudget);
      },
      onPause: () => {
        const threadId = ports.state.chat().activeThread.id;
        if (!threadId) return;
        void ports.actions.goal.setStatus(threadId, "paused");
      },
      onResume: () => {
        const threadId = ports.state.chat().activeThread.id;
        if (!threadId) return;
        void ports.actions.goal.setStatus(threadId, "active");
      },
      onClear: () => {
        const threadId = ports.state.chat().activeThread.id;
        if (!threadId) return;
        void ports.actions.goal.clear(threadId);
      },
    },
    options: {
      sendShortcut: ports.settings.sendShortcut(),
      editingRequested: state.ui.openDetails.has("goal:editor"),
      onEditingChange: (editing) => {
        ports.actions.goal.setEditingOpen(editing);
      },
    },
  };
}

export function chatPanelComposerPlaceholder(ports: ChatPanelComposerPorts): string {
  return buildComposerPlaceholder(buildActiveComposerThreadName(ports.state.chat(), ports.thread.restoredPlaceholder()));
}

export function chatPanelComposerMetaViewModel(ports: ChatPanelComposerPorts) {
  return {
    ...buildComposerMetaViewModel(ports.state.chat(), ports.runtime.snapshot()),
    ...runtimeComposerChoices({
      state: ports.state.chat(),
      snapshot: ports.runtime.snapshot(),
      setRequestedModel: (model) => void ports.runtime.setRequestedModel(model),
      setRequestedReasoningEffort: (effort) => void ports.runtime.setRequestedReasoningEffort(effort),
    }),
  };
}

export function chatPanelPendingRequestsSignature(ports: ChatPanelMessagesPorts): string {
  const state = ports.state.chat();
  return requestStateSignature(state.requests.approvals, state.requests.pendingUserInputs, state.requests.userInputDrafts);
}

function chatStateWithSlices(state: ChatPanelShellState, slices: Partial<ChatState>): ChatState {
  return {
    ...state.latestState(),
    ...slices,
  };
}
