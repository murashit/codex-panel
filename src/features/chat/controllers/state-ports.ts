import type { InitializeResponse } from "../../../generated/app-server/InitializeResponse";
import type { Thread } from "../../../generated/app-server/v2/Thread";
import type { ThreadTokenUsage } from "../../../generated/app-server/v2/ThreadTokenUsage";
import { activeTurnId, chatTurnBusy, pendingTurnStart, type ChatStateStore, type PendingTurnStart } from "../chat-state";
import type { PendingApproval } from "../approvals/model";
import type { PendingUserInput } from "../user-input/model";
import type { DisplayItem } from "../display/types";
import { implementPlanCandidateFromState } from "../plan-implementation";
import { resumedThreadAction, type ThreadActivationResponse } from "../thread-resume";
import { composerSlotSnapshot, goalSlotSnapshot, messagesSlotSnapshot, toolbarSlotSnapshot } from "../view-snapshot";
import { renderChatPanelShell } from "../ui/shell";

export interface ConnectionStatePort {
  connectionInitialized(initializeResponse: InitializeResponse): void;
  clearConnectionScope(): void;
  clearLocalTurn(): void;
}

export interface PanelUiStatePort {
  closePanels(): void;
  pinMessagesToBottom(): void;
}

export interface PendingRequestSnapshot {
  approvals: readonly PendingApproval[];
  pendingUserInputs: readonly PendingUserInput[];
  userInputDrafts: ReadonlyMap<string, string>;
  openDetails: ReadonlySet<string>;
}

export interface PendingRequestStatePort {
  snapshot(): PendingRequestSnapshot;
  setDetailOpen(key: string, open: boolean): void;
  setUserInputDraft(key: string, value: string): void;
}

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

export interface SubmissionStateSnapshot {
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

export function createConnectionStatePort(stateStore: ChatStateStore): ConnectionStatePort {
  return {
    connectionInitialized(initializeResponse) {
      stateStore.dispatch({ type: "connection/initialized", initializeResponse });
    },
    clearConnectionScope() {
      stateStore.dispatch({ type: "connection/scoped-cleared" });
    },
    clearLocalTurn() {
      stateStore.dispatch({ type: "turn/local-cleared" });
    },
  };
}

export function createPanelUiStatePort(stateStore: ChatStateStore): PanelUiStatePort {
  return {
    closePanels() {
      stateStore.dispatch({ type: "ui/panel-set", panel: null });
    },
    pinMessagesToBottom() {
      stateStore.dispatch({ type: "ui/messages-pinned-set", pinned: true });
    },
  };
}

export function createPendingRequestStatePort(stateStore: ChatStateStore): PendingRequestStatePort {
  return {
    snapshot() {
      const state = stateStore.getState();
      return {
        approvals: state.approvals,
        pendingUserInputs: state.pendingUserInputs,
        userInputDrafts: state.userInputDrafts,
        openDetails: state.openDetails,
      };
    },
    setDetailOpen(key, open) {
      stateStore.dispatch({ type: "ui/detail-open-set", key, open });
    },
    setUserInputDraft(key, value) {
      stateStore.dispatch({ type: "request/user-input-draft-set", key, value });
    },
  };
}

export function createThreadLifecycleStatePort(stateStore: ChatStateStore): ThreadLifecycleStatePort {
  return {
    activeThreadId: () => stateStore.getState().activeThreadId,
    canSwitchToThread(threadId) {
      const state = stateStore.getState();
      return !chatTurnBusy(state) || threadId === state.activeThreadId;
    },
    get listedThreads() {
      return stateStore.getState().listedThreads;
    },
    clearActiveThread() {
      stateStore.dispatch({ type: "thread/active-cleared" });
    },
    applyThreadList(threads) {
      stateStore.dispatch({ type: "thread/list-applied", threads });
    },
    restorePlaceholder(threadId, item) {
      stateStore.dispatch({ type: "thread/restored-placeholder", threadId, item });
    },
    displayItemsEmpty: () => stateStore.getState().displayItems.length === 0,
    applyResumedThread(response, displayItems) {
      stateStore.dispatch(
        resumedThreadAction({
          response,
          listedThreads: stateStore.getState().listedThreads,
          displayItems,
        }),
      );
    },
    applyTokenUsage(threadId, tokenUsage) {
      if (stateStore.getState().activeThreadId !== threadId) return false;
      stateStore.dispatch({ type: "thread/token-usage-set", tokenUsage });
      return true;
    },
    applyRecoveredTokenUsage(threadId, tokenUsage) {
      const state = stateStore.getState();
      if (state.activeThreadId !== threadId || state.tokenUsage !== null) return false;
      stateStore.dispatch({ type: "thread/token-usage-set", tokenUsage });
      return true;
    },
  };
}

export function createSubmissionStatePort(stateStore: ChatStateStore): SubmissionStatePort {
  return {
    snapshot() {
      const state = stateStore.getState();
      return {
        activeThreadId: state.activeThreadId,
        activeTurnId: activeTurnId(state),
        busy: chatTurnBusy(state),
        listedThreads: state.listedThreads,
        displayItems: state.displayItems,
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
      stateStore.dispatch({ type: "system/message-added", item });
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
