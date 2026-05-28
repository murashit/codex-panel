import type { ChatAction } from "./chat-state";
import type { DisplayDetailSection, DisplayItem } from "./display/types";
import type { ChatViewRenderScheduleOptions, RestoredThreadState } from "./view-lifecycle";

export interface ChatViewEffectHost {
  render: () => void;
  renderShellSlots: () => void;
  scheduleRender: (options?: ChatViewRenderScheduleOptions) => void;
  refreshLiveState: () => void;
  deferRefreshLiveState: () => void;
  forceMessagesToBottom: () => void;
  preserveMessageScrollPosition: () => void;
  scrollMessagesToBottomOnFocus: () => void;
  setStatus: (status: string) => void;
  addSystemMessage: (text: string) => void;
  addStructuredSystemMessage: (text: string, details: DisplayDetailSection[]) => void;
  notifyActiveThreadIdentityChanged: () => void;
  resetThreadTurnPresence: (hadTurns: boolean) => void;
  invalidateConnectionWork: () => void;
  invalidateResumeWork: () => void;
  scheduleDeferredDiagnostics: () => void;
  clearDeferredDiagnostics: () => void;
  scheduleDeferredRestoredThreadHydration: () => void;
  clearDeferredRestoredThreadHydration: () => void;
  scheduleDeferredAppServerWarmup: () => void;
  dispatch: (action: ChatAction) => void;
  systemItem: (text: string) => DisplayItem;
  restoreThreadPlaceholder: (restoredThread: RestoredThreadState) => void;
  clearRestoredThreadLifecycle: () => void;
  refreshTabHeader: () => void;
  clearClient: () => void;
  setComposerText: (text: string) => void;
  ensureConnected: () => Promise<void>;
}

export interface ChatViewEffects {
  render: {
    now: () => void;
    shellSlots: () => void;
    schedule: (options?: ChatViewRenderScheduleOptions) => void;
  };
  liveState: {
    refresh: () => void;
    deferRefresh: () => void;
  };
  scroll: {
    forceBottom: () => void;
    preservePosition: () => void;
    bottomOnFocus: () => void;
  };
  status: {
    set: (status: string) => void;
    addSystemMessage: (text: string) => void;
    addStructuredSystemMessage: (text: string, details: DisplayDetailSection[]) => void;
  };
  thread: {
    notifyIdentityChanged: () => void;
    resetTurnPresence: (hadTurns: boolean) => void;
    restorePlaceholder: (restoredThread: RestoredThreadState) => void;
    clearRestoredLifecycle: () => void;
    refreshTabHeader: () => void;
  };
  lifecycle: {
    invalidateConnectionWork: () => void;
    invalidateResumeWork: () => void;
    scheduleDeferredDiagnostics: () => void;
    clearDeferredDiagnostics: () => void;
    scheduleDeferredRestoredThreadHydration: () => void;
    clearDeferredRestoredThreadHydration: () => void;
    scheduleDeferredAppServerWarmup: () => void;
  };
  state: {
    dispatch: (action: ChatAction) => void;
    systemItem: (text: string) => DisplayItem;
  };
  client: {
    clear: () => void;
    ensureConnected: () => Promise<void>;
  };
  composer: {
    setText: (text: string) => void;
  };
}

export function createChatViewEffects(host: ChatViewEffectHost): ChatViewEffects {
  return {
    render: {
      now: host.render,
      shellSlots: host.renderShellSlots,
      schedule: host.scheduleRender,
    },
    liveState: {
      refresh: host.refreshLiveState,
      deferRefresh: host.deferRefreshLiveState,
    },
    scroll: {
      forceBottom: host.forceMessagesToBottom,
      preservePosition: host.preserveMessageScrollPosition,
      bottomOnFocus: host.scrollMessagesToBottomOnFocus,
    },
    status: {
      set: host.setStatus,
      addSystemMessage: host.addSystemMessage,
      addStructuredSystemMessage: host.addStructuredSystemMessage,
    },
    thread: {
      notifyIdentityChanged: host.notifyActiveThreadIdentityChanged,
      resetTurnPresence: host.resetThreadTurnPresence,
      restorePlaceholder: host.restoreThreadPlaceholder,
      clearRestoredLifecycle: host.clearRestoredThreadLifecycle,
      refreshTabHeader: host.refreshTabHeader,
    },
    lifecycle: {
      invalidateConnectionWork: host.invalidateConnectionWork,
      invalidateResumeWork: host.invalidateResumeWork,
      scheduleDeferredDiagnostics: host.scheduleDeferredDiagnostics,
      clearDeferredDiagnostics: host.clearDeferredDiagnostics,
      scheduleDeferredRestoredThreadHydration: host.scheduleDeferredRestoredThreadHydration,
      clearDeferredRestoredThreadHydration: host.clearDeferredRestoredThreadHydration,
      scheduleDeferredAppServerWarmup: host.scheduleDeferredAppServerWarmup,
    },
    state: {
      dispatch: host.dispatch,
      systemItem: host.systemItem,
    },
    client: {
      clear: host.clearClient,
      ensureConnected: host.ensureConnected,
    },
    composer: {
      setText: host.setComposerText,
    },
  };
}
