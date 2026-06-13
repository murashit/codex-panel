import type { App, Component } from "obsidian";

import type { CodexChatHost } from "../../chat-host";
import type { DisplayItem } from "../../display/types";
import { MessageStreamPresenter } from "../../panel/surface/message-stream-presenter";
import type { MessageStreamScrollBridge } from "../../panel/surface/message-stream-scroll";
import type { ChatStateStore } from "../../state/reducer";
import type { ThreadManagementActions } from "../../threads/thread-management-actions";
import type { HistoryController } from "../../threads/history-controller";
import type { ChatMessageScrollIntentState } from "../../ui/message-stream/scroll-intent-state";
import type { PendingRequestController } from "../pending-requests/controller";
import type { PlanImplementation } from "../turns/plan-implementation";

export interface ConversationMessageStreamContext {
  obsidian: {
    app: App;
    owner: Component;
  };
  plugin: CodexChatHost;
  stateStore: ChatStateStore;
  lifecycle: {
    messageScrollIntent: ChatMessageScrollIntentState;
  };
  scroll: {
    bridge: MessageStreamScrollBridge;
  };
  surface: {
    pendingRequestsSignature: () => string;
  };
}

export interface ConversationMessageStreamRefs {
  history: HistoryController;
  threadActions: ThreadManagementActions;
  pendingRequests: PendingRequestController;
  planImplementation: PlanImplementation;
}

export function createConversationMessageStreamPresenter(
  context: ConversationMessageStreamContext,
  refs: ConversationMessageStreamRefs,
): MessageStreamPresenter {
  const { obsidian, plugin, stateStore, lifecycle, scroll, surface } = context;
  const { messageScrollIntent } = lifecycle;
  const scrollBridge = scroll.bridge;
  return new MessageStreamPresenter({
    obsidian,
    state: {
      store: stateStore,
    },
    workspace: {
      vaultPath: plugin.vaultPath,
    },
    scroll: {
      consumeIntent: () => messageScrollIntent.consumeIntent(),
      registerVirtualizer: scrollBridge.registerVirtualizer,
      dispose: () => {
        scrollBridge.dispose();
      },
    },
    history: {
      loadOlderTurns: () => void refs.history.loadOlder(),
    },
    actions: {
      rollbackThread: (threadId) => void refs.threadActions.rollbackThread(threadId),
      forkThreadFromTurn: (threadId, turnId, archiveSource) => void refs.threadActions.forkThreadFromTurn(threadId, turnId, archiveSource),
      implementPlan: (item: DisplayItem) => void refs.planImplementation.implement(item),
      openTurnDiff: (state) => void plugin.openTurnDiff(state),
    },
    requests: {
      pendingSignature: surface.pendingRequestsSignature,
      pendingSnapshot: () => refs.pendingRequests.snapshot(),
      pendingActions: () => refs.pendingRequests.actions(),
      consumePendingAutoFocus: () => refs.pendingRequests.consumeAutoFocus(),
    },
  });
}
