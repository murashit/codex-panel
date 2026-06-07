import type { Thread } from "../../../generated/app-server/v2/Thread";
import { activeTurnId, chatTurnBusy, pendingTurnStart, type ChatStateStore, type PendingTurnStart } from "../chat-state";
import type { DisplayItem } from "../display/types";
import { implementPlanCandidateFromState } from "../plan-implementation";
import { composerSlotSnapshot, goalSlotSnapshot, messagesSlotSnapshot, toolbarSlotSnapshot } from "../panel/snapshot";
import { renderChatPanelShell } from "../ui/shell";

interface SubmissionStateSnapshot {
  activeThreadId: string | null;
  activeTurnId: string | null;
  busy: boolean;
  listedThreads: readonly Thread[];
  displayItems: readonly DisplayItem[];
  pendingTurnStart: PendingTurnStart | null;
}

export interface SubmissionStatePort {
  snapshot(): SubmissionStateSnapshot;
  canImplementPlan(item: DisplayItem): boolean;
  prepareImplementationTurn(): void;
  optimisticTurnStarted(item: DisplayItem, pendingStart: PendingTurnStart): void;
  turnStartAcknowledged(turnId: string, displayItems: readonly DisplayItem[]): void;
  turnStartFailed(displayItems: readonly DisplayItem[]): void;
  addLocalUserMessage(item: DisplayItem): void;
}

export interface ChatShellRenderPort {
  render(
    root: HTMLElement,
    renderVersion: number,
    slots: {
      renderToolbar: (toolbar: HTMLElement) => void;
      renderGoal: (goal: HTMLElement) => void;
      renderMessages: (parent: HTMLElement) => void;
      renderComposer: (parent: HTMLElement) => void;
    },
  ): void;
}

export function createSubmissionStatePort(stateStore: ChatStateStore): SubmissionStatePort {
  return {
    snapshot() {
      const state = stateStore.getState();
      return {
        activeThreadId: state.activeThread.id,
        activeTurnId: activeTurnId(state),
        busy: chatTurnBusy(state),
        listedThreads: state.threadList.listedThreads,
        displayItems: state.transcript.displayItems,
        pendingTurnStart: pendingTurnStart(state),
      };
    },
    canImplementPlan: (item) => item.id === implementPlanCandidateFromState(stateStore.getState())?.id,
    prepareImplementationTurn() {
      stateStore.dispatch({ type: "runtime/requested-collaboration-mode-set", collaborationMode: "default" });
      stateStore.dispatch({ type: "ui/panel-set", panel: null });
    },
    optimisticTurnStarted(item, pendingStart) {
      stateStore.dispatch({ type: "turn/optimistic-started", item, pendingTurnStart: pendingStart });
    },
    turnStartAcknowledged(turnId, displayItems) {
      stateStore.dispatch({ type: "turn/start-acknowledged", turnId, displayItems });
    },
    turnStartFailed(displayItems) {
      stateStore.dispatch({ type: "turn/start-failed", displayItems });
    },
    addLocalUserMessage(item) {
      stateStore.dispatch({ type: "transcript/system-message-added", item });
    },
  };
}

export function createChatShellRenderPort(
  stateStore: ChatStateStore,
  options: {
    connected: () => boolean;
    showToolbar: () => boolean;
    pendingRequestsSignature: () => string;
    activeComposerThreadName: () => string | null;
  },
): ChatShellRenderPort {
  return {
    render(root, renderVersion, slots) {
      renderChatPanelShell(root, {
        stateStore,
        renderVersion,
        showToolbar: options.showToolbar(),
        toolbar: { render: slots.renderToolbar, snapshot: (state) => toolbarSlotSnapshot(state, options.connected()) },
        goal: { render: slots.renderGoal, snapshot: goalSlotSnapshot },
        messages: {
          render: slots.renderMessages,
          snapshot: (state) => messagesSlotSnapshot(state, options.pendingRequestsSignature()),
        },
        composer: {
          render: slots.renderComposer,
          snapshot: (state) => composerSlotSnapshot(state, options.activeComposerThreadName()),
        },
      });
    },
  };
}
