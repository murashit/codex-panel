import type { RequestId, ServerNotification, ServerRequest } from "../../../../app-server/connection/rpc-messages";
import {
  routeServerRequest,
  serverRequestApprovalResponse,
  serverRequestCurrentTimeResponse,
  serverRequestMcpElicitationResponse,
  serverRequestUserInputResponse,
} from "../../../../app-server/routing/server-requests";
import {
  type ApprovalAction,
  contentForPendingMcpElicitation,
  type McpElicitationAction,
  type PendingRequestId,
  type PendingUserInput,
} from "../../../../domain/pending-requests/model";
import type { TurnTranscriptSummary } from "../../../../domain/threads/transcript";
import type { ThreadOperationEvent } from "../../../threads/workflows/thread-operation-event";
import type { AppServerResourceEvent } from "../../application/connection/server-metadata-actions";
import type { LocalIdSource } from "../../application/local-id-source";
import { activeThreadId, type ChatAction, type ChatState } from "../../application/state/root-reducer";
import type { ChatStateStore } from "../../application/state/store";
import { activeTurnId } from "../../application/turns/turn-state";
import {
  createApprovalResultItem,
  createMcpElicitationResultItem,
  createUserInputResultItem,
} from "../../domain/pending-requests/result-items";
import { createStructuredSystemItem, createSystemItem } from "../../domain/thread-stream/factories/system-items";
import type { ThreadStreamNoticeSection } from "../../domain/thread-stream/items";
import { classifyAppServerLog } from "./app-server-logs";
import { type ChatNotificationEffect, planChatNotification } from "./notification-plan";

export interface ChatInboundHandlerActions {
  refreshServerDiagnostics: (options?: { forceResourceProbes?: boolean }) => void;
  applyAppServerResourceEvent: (event: AppServerResourceEvent) => void;
  maybeNameThread: (threadId: string, turnId: string, completedTurnTranscriptSummary: TurnTranscriptSummary | null) => void;
  applyThreadOperationEvent: (event: ThreadOperationEvent) => void;
  respondToServerRequest: (requestId: RequestId, result: unknown) => boolean;
  rejectServerRequest: (requestId: RequestId, code: number, message: string) => boolean;
}

export interface ChatInboundHandler {
  handleNotification(notification: ServerNotification): void;
  handleServerRequest(request: ServerRequest): void;
  handleAppServerLog(message: string): void;
  resolveApproval(requestId: PendingRequestId, action: ApprovalAction): void;
  resolveUserInput(requestId: PendingRequestId, answers: Record<string, string>): void;
  cancelUserInput(requestId: PendingRequestId): void;
  resolveMcpElicitation(requestId: PendingRequestId, action: McpElicitationAction): void;
  addSystemMessage(text: string): void;
  addStructuredSystemMessage(text: string, details: ThreadStreamNoticeSection[]): void;
  addDedupedSystemMessage(text: string): void;
}

interface ChatInboundHandlerContext {
  store: ChatStateStore;
  actions: ChatInboundHandlerActions;
  localItemIds: LocalIdSource;
}

export function createChatInboundHandler(
  store: ChatStateStore,
  actions: ChatInboundHandlerActions,
  localItemIds: LocalIdSource,
): ChatInboundHandler {
  const context: ChatInboundHandlerContext = { store, actions, localItemIds };
  return {
    handleNotification: (notification) => {
      handleNotification(context, notification);
    },
    handleServerRequest: (request) => {
      handleServerRequest(context, request);
    },
    handleAppServerLog: (message) => {
      handleAppServerLog(context, message);
    },
    resolveApproval: (requestId, action) => {
      resolveApproval(context, requestId, action);
    },
    resolveUserInput: (requestId, answers) => {
      resolveUserInput(context, requestId, answers);
    },
    cancelUserInput: (requestId) => {
      cancelUserInput(context, requestId);
    },
    resolveMcpElicitation: (requestId, action) => {
      resolveMcpElicitation(context, requestId, action);
    },
    addSystemMessage: (text) => {
      addSystemMessage(context, text);
    },
    addStructuredSystemMessage: (text, details) => {
      addStructuredSystemMessage(context, text, details);
    },
    addDedupedSystemMessage: (text) => {
      addDedupedSystemMessage(context, text);
    },
  };
}

function state(context: ChatInboundHandlerContext): ChatState {
  return context.store.getState();
}

function dispatch(context: ChatInboundHandlerContext, action: ChatAction): void {
  context.store.dispatch(action);
}

function handleNotification(context: ChatInboundHandlerContext, notification: ServerNotification): void {
  const plan = planChatNotification(state(context), notification, (prefix) => localItemId(context, prefix));
  for (const action of plan.actions) dispatch(context, action);
  for (const effect of plan.effects) runNotificationEffect(context, effect);
}

function handleServerRequest(context: ChatInboundHandlerContext, request: ServerRequest): void {
  const current = state(context);
  const route = routeServerRequest(request, { activeThreadId: activeThreadId(current), activeTurnId: activeTurnId(current) });
  switch (route.kind) {
    case "approval":
      dispatch(context, { type: "request/approval-queued", approval: route.approval });
      return;
    case "userInput":
      dispatch(context, { type: "request/user-input-queued", input: route.input });
      return;
    case "mcpElicitation":
      dispatch(context, { type: "request/mcp-elicitation-queued", elicitation: route.elicitation });
      return;
    case "currentTime":
      if (!context.actions.respondToServerRequest(route.request.id, serverRequestCurrentTimeResponse(Date.now()))) {
        addSystemMessage(context, "Could not send current time because Codex app-server is not connected.");
      }
      return;
    case "inactive":
      rejectServerRequest(context, request, `Rejected inactive app-server request: ${request.method}`);
      return;
    case "unsupported":
      rejectServerRequest(context, request, `Rejected unsupported app-server request: ${request.method}`);
      return;
    case "unknown": {
      const message = `Rejected unknown app-server request: ${request.method}`;
      context.actions.rejectServerRequest(request.id, -32601, message);
      return;
    }
  }
}

function handleAppServerLog(context: ChatInboundHandlerContext, message: string): void {
  const classified = classifyAppServerLog(message);
  if (classified === null) return;
  if (classified.kind === "plain") {
    addDedupedSystemMessage(context, classified.text);
  } else {
    addDedupedSystemMessage(context, `app-server error: ${classified.text}`);
  }
}

function resolveApproval(context: ChatInboundHandlerContext, requestId: PendingRequestId, action: ApprovalAction): void {
  const approval = state(context).requests.approvals.find((item) => item.requestId === requestId) ?? null;
  if (!approval) return;
  if (!context.actions.respondToServerRequest(approval.requestId, serverRequestApprovalResponse(approval, action))) {
    addSystemMessage(context, "Could not send approval response because Codex app-server is not connected.");
    return;
  }
  dispatch(context, { type: "request/resolved", requestId: approval.requestId, resultItem: createApprovalResultItem(approval, action) });
}

function resolveUserInput(context: ChatInboundHandlerContext, requestId: PendingRequestId, answers: Record<string, string>): void {
  const input = pendingUserInput(context, requestId);
  if (!input) return;
  if (!context.actions.respondToServerRequest(input.requestId, serverRequestUserInputResponse(input.params.questions, answers))) {
    addSystemMessage(context, "Could not send user input because Codex app-server is not connected.");
    return;
  }
  dispatch(context, {
    type: "request/resolved",
    requestId: input.requestId,
    resultItem: createUserInputResultItem(input, answers, "submitted"),
  });
}

function cancelUserInput(context: ChatInboundHandlerContext, requestId: PendingRequestId): void {
  const input = pendingUserInput(context, requestId);
  if (!input) return;
  if (!context.actions.rejectServerRequest(input.requestId, -32000, "User cancelled input request.")) {
    addSystemMessage(context, "Could not cancel user input because Codex app-server is not connected.");
    return;
  }
  dispatch(context, {
    type: "request/resolved",
    requestId: input.requestId,
    resultItem: createUserInputResultItem(input, {}, "cancelled"),
  });
}

function resolveMcpElicitation(context: ChatInboundHandlerContext, requestId: PendingRequestId, action: McpElicitationAction): void {
  const elicitation = state(context).requests.pendingMcpElicitations.find((item) => item.requestId === requestId) ?? null;
  if (!elicitation) return;
  const content = action === "accept" ? contentForPendingMcpElicitation(elicitation, state(context).requests.mcpElicitationDrafts) : null;
  if (!context.actions.respondToServerRequest(elicitation.requestId, serverRequestMcpElicitationResponse(action, content))) {
    addSystemMessage(context, "Could not send MCP request response because Codex app-server is not connected.");
    return;
  }
  dispatch(context, {
    type: "request/resolved",
    requestId: elicitation.requestId,
    resultItem: createMcpElicitationResultItem(elicitation, action, content),
  });
}

function pendingUserInput(context: ChatInboundHandlerContext, requestId: PendingRequestId): PendingUserInput | null {
  return state(context).requests.pendingUserInputs.find((input) => input.requestId === requestId) ?? null;
}

function addSystemMessage(context: ChatInboundHandlerContext, text: string): void {
  dispatch(context, { type: "thread-stream/system-item-added", item: createSystemItem(localItemId(context, "system"), text) });
}

function addStructuredSystemMessage(context: ChatInboundHandlerContext, text: string, details: ThreadStreamNoticeSection[]): void {
  dispatch(context, {
    type: "thread-stream/system-item-added",
    item: createStructuredSystemItem(localItemId(context, "system"), text, details),
  });
}

function addDedupedSystemMessage(context: ChatInboundHandlerContext, text: string): void {
  dispatch(context, { type: "thread-stream/deduped-log-added", text, item: createSystemItem(localItemId(context, "system"), text) });
}

function rejectServerRequest(context: ChatInboundHandlerContext, request: ServerRequest, message: string): void {
  addSystemMessage(context, message);
  if (!context.actions.rejectServerRequest(request.id, -32601, message)) {
    addSystemMessage(context, "Could not reject app-server request because Codex app-server is not connected.");
  }
}

function localItemId(context: ChatInboundHandlerContext, prefix: string): string {
  return context.localItemIds.next(prefix);
}

function runNotificationEffect(context: ChatInboundHandlerContext, effect: ChatNotificationEffect): void {
  switch (effect.type) {
    case "refresh-server-diagnostics":
      context.actions.refreshServerDiagnostics({ forceResourceProbes: effect.forceResourceProbes === true });
      return;
    case "apply-app-server-resource-event":
      context.actions.applyAppServerResourceEvent(effect.event);
      return;
    case "maybe-name-thread":
      context.actions.maybeNameThread(effect.threadId, effect.turnId, effect.completedTurnTranscriptSummary);
      return;
    case "apply-thread-operation-event":
      context.actions.applyThreadOperationEvent(effect.event);
      return;
  }
}
