import type { ChatMessageScrollController } from "../controllers/view/message-scroll-controller";
import type { ChatAction } from "../chat-state";
import type { CodexChatHost } from "../chat-host";
import type { DisplayDetailSection, DisplayItem } from "../display/types";
import { createSystemItem } from "../display/system";
import type { ChatViewEffects } from "./effects";
import type { ChatViewRenderScheduleOptions, RestoredThreadState } from "./lifecycle";

export interface ChatViewEffectHandlersOptions {
  plugin: CodexChatHost;
  viewWindow: () => Window;
  renderCommands: {
    render: (options?: ChatViewRenderScheduleOptions) => void;
    renderShellSlots: () => void;
    forceMessagesToBottom: () => void;
    correctMessagesAfterLayoutChange: () => void;
  };
  statusCommands: {
    addSystemMessage: (text: string) => void;
    addStructuredSystemMessage: (text: string, details: DisplayDetailSection[]) => void;
  };
  threadCommands: {
    resetThreadTurnPresence: (hadTurns: boolean) => void;
    restorePlaceholder: (restoredThread: RestoredThreadState) => void;
    clearRestoredLifecycle: () => void;
  };
  connectionCommands: {
    invalidate: () => void;
    ensureConnected: () => Promise<void>;
  };
  composerCommands: {
    setText: (text: string) => void;
  };
  messageScroll: ChatMessageScrollController;
  scheduleRender: (options?: ChatViewRenderScheduleOptions) => void;
  notifyActiveThreadIdentityChanged: () => void;
  refreshTabHeader: () => void;
  invalidateResumeWork: () => void;
  scheduleDeferredDiagnostics: () => void;
  clearDeferredDiagnostics: () => void;
  scheduleDeferredRestoredThreadHydration: () => void;
  clearDeferredRestoredThreadHydration: () => void;
  scheduleDeferredAppServerWarmup: () => void;
  dispatch: (action: ChatAction) => void;
  clearClient: () => void;
}

export function createChatViewEffectHandlers(options: ChatViewEffectHandlersOptions): ChatViewEffects {
  return {
    render: {
      now: () => {
        options.renderCommands.render();
      },
      shellSlots: () => {
        options.renderCommands.renderShellSlots();
      },
      schedule: (renderOptions) => {
        options.scheduleRender(renderOptions);
      },
    },
    liveState: {
      refresh: () => {
        options.plugin.refreshThreadsViewLiveState();
      },
      deferRefresh: () => {
        options.viewWindow().setTimeout(() => {
          options.plugin.refreshThreadsViewLiveState();
        }, 0);
      },
    },
    scroll: {
      forceBottom: () => {
        options.messageScroll.forceBottom();
        options.renderCommands.forceMessagesToBottom();
      },
      correctAfterLayoutChange: () => {
        options.renderCommands.correctMessagesAfterLayoutChange();
      },
      preservePosition: () => {
        options.messageScroll.preservePosition();
      },
      bottomOnFocus: () => {
        options.messageScroll.scrollToBottomOnFocus();
      },
    },
    status: {
      set: (status) => {
        options.dispatch({ type: "connection/status-set", status });
      },
      addSystemMessage: (text) => {
        options.statusCommands.addSystemMessage(text);
      },
      addStructuredSystemMessage: (text, details) => {
        options.statusCommands.addStructuredSystemMessage(text, details);
      },
    },
    thread: {
      notifyIdentityChanged: options.notifyActiveThreadIdentityChanged,
      resetTurnPresence: (hadTurns) => {
        options.threadCommands.resetThreadTurnPresence(hadTurns);
      },
      restorePlaceholder: (restoredThread) => {
        options.threadCommands.restorePlaceholder(restoredThread);
      },
      clearRestoredLifecycle: () => {
        options.threadCommands.clearRestoredLifecycle();
      },
      refreshTabHeader: options.refreshTabHeader,
    },
    lifecycle: {
      invalidateConnectionWork: () => {
        options.connectionCommands.invalidate();
      },
      invalidateResumeWork: options.invalidateResumeWork,
      scheduleDeferredDiagnostics: options.scheduleDeferredDiagnostics,
      clearDeferredDiagnostics: options.clearDeferredDiagnostics,
      scheduleDeferredRestoredThreadHydration: options.scheduleDeferredRestoredThreadHydration,
      clearDeferredRestoredThreadHydration: options.clearDeferredRestoredThreadHydration,
      scheduleDeferredAppServerWarmup: options.scheduleDeferredAppServerWarmup,
    },
    state: {
      dispatch: options.dispatch,
      systemItem,
    },
    client: {
      clear: options.clearClient,
      ensureConnected: options.connectionCommands.ensureConnected,
    },
    composer: {
      setText: (text) => {
        options.composerCommands.setText(text);
      },
    },
  };
}

function systemItem(text: string): DisplayItem {
  return createSystemItem(`system-${String(Date.now())}-${Math.random().toString(36).slice(2)}`, text);
}
