import type { AppServerServerRequestResponder } from "../../../../app-server/connection/client";
import type { ServerNotification, ServerRequest } from "../../../../app-server/connection/rpc-messages";
import type { TurnTranscriptSummary } from "../../../../domain/threads/transcript";
import type { PanelDynamicToolCall, PanelDynamicToolResponse } from "../../application/dynamic-tools";
import type { LocalIdSource } from "../../application/local-id-source";
import type { PendingRequests } from "../../application/pending-requests/controller";
import type { ChatStateStore } from "../../application/state/store";
import { createSystemItem } from "../../domain/thread-stream/factories/system-items";
import { classifyAppServerLog } from "./app-server-logs";
import { planChatInboundNotification } from "./notification-plan";
import { ChatServerRequests } from "./server-requests";

export interface ChatInboundHandlerEffects {
  maybeNameThread: (threadId: string, turnId: string, completedTurnTranscriptSummary: TurnTranscriptSummary | null) => void;
  executeDynamicTool: (call: PanelDynamicToolCall) => PanelDynamicToolResponse;
}

export interface ChatInboundHandler {
  readonly pendingRequests: PendingRequests;
  handleNotification(notification: ServerNotification): void;
  handleServerRequest(request: ServerRequest, responder: AppServerServerRequestResponder): boolean;
  handleAppServerLog(message: string): void;
  clearServerRequests(reason?: "disconnect" | "close"): void;
}

export function createChatInboundHandler(
  store: ChatStateStore,
  effects: ChatInboundHandlerEffects,
  localItemIds: LocalIdSource,
): ChatInboundHandler {
  const requests = new ChatServerRequests({
    stateStore: store,
    executeDynamicTool: effects.executeDynamicTool,
    addSystemMessage: (text) => {
      store.dispatch({ type: "thread-stream/system-item-added", item: createSystemItem(localItemIds.next("system"), text) });
    },
  });
  return {
    pendingRequests: requests.pending,
    handleNotification: (notification) => {
      requests.pending.reconcile();
      if (notification.method === "serverRequest/resolved" && requests.resolved(notification.params.requestId)) return;
      const plan = planChatInboundNotification(store.getState(), notification, (prefix) => localItemIds.next(prefix));
      for (const action of plan.actions) store.dispatch(action);
      for (const effect of plan.effects) {
        effects.maybeNameThread(effect.threadId, effect.turnId, effect.completedTurnTranscriptSummary);
      }
      requests.pending.reconcile();
    },
    handleServerRequest: (request, responder) => requests.handle(request, responder),
    handleAppServerLog: (message) => {
      const classified = classifyAppServerLog(message);
      if (classified === null) return;
      const text = `app-server error: ${classified.text}`;
      store.dispatch({ type: "thread-stream/deduped-log-added", text, item: createSystemItem(localItemIds.next("system"), text) });
    },
    clearServerRequests: (reason) => {
      requests.clear(reason);
    },
  };
}
