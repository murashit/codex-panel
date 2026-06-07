import type { Thread } from "../../../generated/app-server/v2/Thread";
import type { ThreadTokenUsage } from "../../../generated/app-server/v2/ThreadTokenUsage";
import { activeTurnId, chatTurnBusy, pendingTurnStart, type ChatStateStore, type PendingTurnStart } from "../chat-state";
import type { DisplayItem } from "../display/types";
import { implementPlanCandidateFromState } from "../plan-implementation";
import { resumedThreadAction, type ThreadActivationResponse } from "../thread-resume";
import { composerSlotSnapshot, goalSlotSnapshot, messagesSlotSnapshot, toolbarSlotSnapshot } from "../panel/snapshot";
import { renderChatPanelShell } from "../ui/shell";

export interface ThreadLifecycleStatePort {
  activeThreadId(): string | null;
  canSwitchToThread(threadId: string): boolean;
  listedThreads: readonly Thread[];
  clearActiveThread(): void;
  applyThreadList(threads: readonly Thread[]): void;
  restorePlaceholder(threadId: string, item: DisplayItem): void;
  displayItemsEmpty(): boolean;
  applyResumedThread(response: ThreadActivationResponse, displayItems: readonly DisplayItem[]): void;
  applyTokenUsage(threadId: string, tokenUsage: ThreadTokenUsage): boolean;
  applyRecoveredTokenUsage(threadId: string, tokenUsage: ThreadTokenUsage): boolean;
}

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

export function createThreadLifecycleStatePort(stateStore: ChatStateStore): ThreadLifecycleStatePort {
  return {
    activeThreadId: () => stateStore.getState().activeThread.id,
    canSwitchToThread(threadId) {
      const state = stateStore.getState();
      return !chatTurnBusy(state) || threadId === state.activeThread.id;
    },
    get listedThreads() {
      return stateStore.getState().threadList.listedThreads;
    },
    clearActiveThread() {
      stateStore.dispatch({ type: "active-thread/cleared" });
    },
    applyThreadList(threads) {
      stateStore.dispatch({ type: "thread-list/applied", threads });
    },
    restorePlaceholder(threadId, item) {
      stateStore.dispatch({ type: "active-thread/restored-placeholder", threadId, item });
    },
    displayItemsEmpty: () => stateStore.getState().transcript.displayItems.length === 0,
    applyResumedThread(response, displayItems) {
      stateStore.dispatch(
        resumedThreadAction({
          response,
          listedThreads: stateStore.getState().threadList.listedThreads,
          displayItems,
        }),
      );
    },
    applyTokenUsage(threadId, tokenUsage) {
      if (stateStore.getState().activeThread.id !== threadId) return false;
      stateStore.dispatch({ type: "active-thread/token-usage-set", tokenUsage });
      return true;
    },
    applyRecoveredTokenUsage(threadId, tokenUsage) {
      const state = stateStore.getState();
      if (state.activeThread.id !== threadId || state.activeThread.tokenUsage !== null) return false;
      stateStore.dispatch({ type: "active-thread/token-usage-set", tokenUsage });
      return true;
    },
  };
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
