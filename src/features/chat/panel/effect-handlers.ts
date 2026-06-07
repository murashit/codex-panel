import type { ChatMessageScrollController } from "../controllers/view/message-scroll-controller";
import type { ChatAction } from "../chat-state";
import type { CodexChatHost } from "../chat-host";
import type { DisplayDetailSection, DisplayItem } from "../display/types";
import { createSystemItem } from "../display/system";
import type { ChatViewControllers } from "./controllers";
import type { ChatViewEffects } from "./effects";
import type { ChatViewRenderScheduleOptions } from "./lifecycle";

export interface ChatViewEffectHandlersOptions {
  plugin: CodexChatHost;
  viewWindow: () => Window;
  controllers: () => ChatViewControllers;
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
  const controllers = options.controllers;
  return {
    render: {
      now: () => {
        controllers().render.controller.render();
      },
      shellSlots: () => {
        controllers().render.controller.renderShellSlots();
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
        controllers().render.messages.forceMessagesToBottom();
      },
      correctAfterLayoutChange: () => {
        controllers().render.messages.correctMessagesAfterLayoutChange();
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
        addSystemMessage(controllers(), text);
      },
      addStructuredSystemMessage: (text, details) => {
        addStructuredSystemMessage(controllers(), text, details);
      },
    },
    thread: {
      notifyIdentityChanged: options.notifyActiveThreadIdentityChanged,
      resetTurnPresence: (hadTurns) => {
        controllers().thread.rename.resetThreadTurnPresence(hadTurns);
      },
      restorePlaceholder: (restoredThread) => {
        controllers().thread.restored.restore(restoredThread);
      },
      clearRestoredLifecycle: () => {
        controllers().thread.restored.clear();
      },
      refreshTabHeader: options.refreshTabHeader,
    },
    lifecycle: {
      invalidateConnectionWork: () => {
        controllers().connection.controller.invalidate();
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
      ensureConnected: () => controllers().connection.controller.ensureConnected(),
    },
    composer: {
      setText: (text) => {
        controllers().composer.controller.setDraft(text, { focus: true, renderIfDetached: true });
      },
    },
  };
}

function addSystemMessage(controllers: ChatViewControllers, text: string): void {
  controllers.inbound.controller.addSystemMessage(text);
  controllers.render.controller.render();
}

function addStructuredSystemMessage(controllers: ChatViewControllers, text: string, details: DisplayDetailSection[]): void {
  controllers.inbound.controller.addStructuredSystemMessage(text, details);
  controllers.render.controller.render();
}

function systemItem(text: string): DisplayItem {
  return createSystemItem(`system-${String(Date.now())}-${Math.random().toString(36).slice(2)}`, text);
}
