import { pendingRequestsSignature as requestStateSignature } from "../pending-requests/view-model";
import {
  composerMetaViewModel as buildComposerMetaViewModel,
  composerPlaceholder as buildComposerPlaceholder,
} from "../panel/view-model/composer";
import { runtimeComposerChoices } from "../panel/view-model/runtime";
import { activeComposerThreadName as buildActiveComposerThreadName } from "../panel/view-model/thread-title";
import { toolbarViewModel as buildToolbarViewModel } from "../panel/view-model/toolbar";
import type { GoalBannerActions, GoalBannerOptions } from "./goal-banner";
import type { ChatPanelComposerPorts, ChatPanelGoalPorts, ChatPanelStatePort, ChatPanelToolbarPorts } from "../panel/ui-ports";
import type { ChatPanelShellState } from "./shell";

export function chatPanelToolbarViewModel(ports: ChatPanelToolbarPorts, shellState: ChatPanelShellState) {
  const latestState = shellState.latestState();
  return buildToolbarViewModel({
    state: {
      ...latestState,
      connection: shellState.connection.value,
      threadList: shellState.threadList.value,
      activeThread: shellState.activeThread.value,
      runtime: shellState.runtime.value,
      turn: shellState.turn.value,
      ui: shellState.ui.value,
    },
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
  const goal = state.activeThread.goal;
  const goalThreadId = goal?.threadId ?? null;
  return {
    goal,
    actions: {
      onSave: (objective, tokenBudget) => {
        void ports.actions.goal.saveObjective(objective, tokenBudget);
      },
      onPause: () => {
        if (!goalThreadId) return;
        void ports.actions.goal.setStatus(goalThreadId, "paused");
      },
      onResume: () => {
        if (!goalThreadId) return;
        void ports.actions.goal.setStatus(goalThreadId, "active");
      },
      onClear: () => {
        if (!goalThreadId) return;
        void ports.actions.goal.clear(goalThreadId);
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
  const state = ports.state.chat();
  const snapshot = ports.runtime.snapshot();
  return {
    ...buildComposerMetaViewModel(state, snapshot),
    ...runtimeComposerChoices({
      state,
      snapshot,
      requestModel: (model) => void ports.runtime.requestModel(model),
      requestReasoningEffort: (effort) => void ports.runtime.requestReasoningEffort(effort),
      resetReasoningEffortToConfig: () => void ports.runtime.resetReasoningEffortToConfig(),
    }),
  };
}

export function chatPanelPendingRequestsSignature(ports: ChatPanelStatePort): string {
  const state = ports.state.chat();
  return requestStateSignature(state.requests.approvals, state.requests.pendingUserInputs, state.requests.userInputDrafts);
}
