import type { RequestId, ServerNotification, ServerRequest } from "../../../../app-server/connection/rpc-messages";
import type { McpServerStartupStatus } from "../../../../domain/server/diagnostics";
import type { Thread } from "../../../../domain/threads/model";
import type { ThreadConversationSummary } from "../../../../domain/threads/transcript";
import type { LocalIdSource } from "../../../../shared/id/local-id";
import { classifyAppServerLog } from "./app-server-logs";
import { activeTurnId, type ChatAction, type ChatState } from "../../application/state/root-reducer";
import type { ChatStateStore } from "../../application/state/store";
import type { MessageStreamNoticeSection } from "../../domain/message-stream/items";
import { createStructuredSystemItem, createSystemItem } from "../../domain/message-stream/factories/system-items";
import {
  contentForPendingMcpElicitation,
  type ApprovalAction,
  type McpElicitationAction,
  type PendingApproval,
  type PendingMcpElicitation,
  type PendingRequestId,
  type PendingUserInput,
} from "../../../../domain/pending-requests/model";
import { approvalResponse } from "../requests/approval";
import { mcpElicitationResponse } from "../requests/mcp-elicitation";
import { userInputResponse } from "../requests/user-input";
import {
  createApprovalResultItem,
  createMcpElicitationResultItem,
  createUserInputResultItem,
} from "../../domain/pending-requests/result-items";
import { planChatNotification, type ChatNotificationEffect } from "./notification-plan";
import { routeServerRequest } from "./routing";

function cannotSendApprovalResponseMessage(): string {
  return "Could not send approval response because Codex app-server is not connected.";
}

function cannotSendUserInputMessage(): string {
  return "Could not send user input because Codex app-server is not connected.";
}

function cannotCancelUserInputMessage(): string {
  return "Could not cancel user input because Codex app-server is not connected.";
}

function cannotSendMcpElicitationMessage(): string {
  return "Could not send MCP request response because Codex app-server is not connected.";
}

function userCancelledInputRequestMessage(): string {
  return "User cancelled input request.";
}

function cannotRejectServerRequestMessage(): string {
  return "Could not reject app-server request because Codex app-server is not connected.";
}

export interface ChatInboundHandlerActions {
  refreshActiveThreads: () => void;
  refreshRateLimits: () => void;
  refreshSkills: (forceReload?: boolean) => void;
  applyAppServerMetadataSnapshot: () => void;
  maybeNameThread: (threadId: string, turnId: string, completedSummary: ThreadConversationSummary | null) => void;
  recordThreadStarted: (thread: Thread) => void;
  applyThreadArchived: (threadId: string) => void;
  recordActiveThreadDeleted: (threadId: string) => void;
  applyThreadRenamed: (threadId: string, name: string | null) => void;
  recordMcpStartupStatus: (name: string, status: McpServerStartupStatus, message: string | null) => void;
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
  addStructuredSystemMessage(text: string, details: MessageStreamNoticeSection[]): void;
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
  const route = routeServerRequest(request, activeRouteScope(context));
  switch (route.kind) {
    case "approval":
      queueApprovalRequest(context, route.approval);
      return;
    case "userInput":
      queueUserInputRequest(context, route.input);
      return;
    case "mcpElicitation":
      queueMcpElicitationRequest(context, route.elicitation);
      return;
    case "inactive":
      rejectServerRequest(context, request, `Rejected inactive app-server request: ${request.method}`);
      return;
    case "unsupported":
      rejectUnsupportedServerRequest(context, request);
      return;
    case "unknown":
      rejectUnknownServerRequest(context, request);
      return;
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
  const approval = pendingApproval(context, requestId);
  if (!approval) return;
  if (!context.actions.respondToServerRequest(approval.requestId, approvalResponse(approval, action))) {
    addSystemMessage(context, cannotSendApprovalResponseMessage());
    return;
  }
  dispatch(context, { type: "request/resolved", requestId: approval.requestId, resultItem: createApprovalResultItem(approval, action) });
}

function resolveUserInput(context: ChatInboundHandlerContext, requestId: PendingRequestId, answers: Record<string, string>): void {
  const input = pendingUserInput(context, requestId);
  if (!input) return;
  if (!context.actions.respondToServerRequest(input.requestId, userInputResponse(input, answers))) {
    addSystemMessage(context, cannotSendUserInputMessage());
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
  if (!context.actions.rejectServerRequest(input.requestId, -32000, userCancelledInputRequestMessage())) {
    addSystemMessage(context, cannotCancelUserInputMessage());
    return;
  }
  dispatch(context, {
    type: "request/resolved",
    requestId: input.requestId,
    resultItem: createUserInputResultItem(input, {}, "cancelled"),
  });
}

function resolveMcpElicitation(context: ChatInboundHandlerContext, requestId: PendingRequestId, action: McpElicitationAction): void {
  const elicitation = pendingMcpElicitation(context, requestId);
  if (!elicitation) return;
  const content = action === "accept" ? contentForPendingMcpElicitation(elicitation, state(context).requests.mcpElicitationDrafts) : null;
  if (!context.actions.respondToServerRequest(elicitation.requestId, mcpElicitationResponse(action, content))) {
    addSystemMessage(context, cannotSendMcpElicitationMessage());
    return;
  }
  dispatch(context, {
    type: "request/resolved",
    requestId: elicitation.requestId,
    resultItem: createMcpElicitationResultItem(elicitation, action, content),
  });
}

function pendingApproval(context: ChatInboundHandlerContext, requestId: PendingRequestId): PendingApproval | null {
  return state(context).requests.approvals.find((approval) => approval.requestId === requestId) ?? null;
}

function pendingUserInput(context: ChatInboundHandlerContext, requestId: PendingRequestId): PendingUserInput | null {
  return state(context).requests.pendingUserInputs.find((input) => input.requestId === requestId) ?? null;
}

function pendingMcpElicitation(context: ChatInboundHandlerContext, requestId: PendingRequestId): PendingMcpElicitation | null {
  return state(context).requests.pendingMcpElicitations.find((elicitation) => elicitation.requestId === requestId) ?? null;
}

function addSystemMessage(context: ChatInboundHandlerContext, text: string): void {
  dispatch(context, { type: "message-stream/system-item-added", item: createSystemItem(localItemId(context, "system"), text) });
}

function addStructuredSystemMessage(context: ChatInboundHandlerContext, text: string, details: MessageStreamNoticeSection[]): void {
  dispatch(context, {
    type: "message-stream/system-item-added",
    item: createStructuredSystemItem(localItemId(context, "system"), text, details),
  });
}

function addDedupedSystemMessage(context: ChatInboundHandlerContext, text: string): void {
  dispatch(context, { type: "message-stream/deduped-log-added", text, item: createSystemItem(localItemId(context, "system"), text) });
}

function queueApprovalRequest(context: ChatInboundHandlerContext, approval: PendingApproval): void {
  dispatch(context, { type: "request/approval-queued", approval });
}

function queueUserInputRequest(context: ChatInboundHandlerContext, userInput: PendingUserInput): void {
  dispatch(context, { type: "request/user-input-queued", input: userInput });
}

function queueMcpElicitationRequest(context: ChatInboundHandlerContext, elicitation: PendingMcpElicitation): void {
  dispatch(context, { type: "request/mcp-elicitation-queued", elicitation });
}

function activeRouteScope(context: ChatInboundHandlerContext): { activeThreadId: string | null; activeTurnId: string | null } {
  const current = state(context);
  return {
    activeThreadId: current.activeThread.id,
    activeTurnId: activeTurnId(current),
  };
}

function rejectUnsupportedServerRequest(context: ChatInboundHandlerContext, request: ServerRequest): void {
  const message = `Rejected unsupported app-server request: ${request.method}`;
  rejectServerRequest(context, request, message);
}

function rejectUnknownServerRequest(context: ChatInboundHandlerContext, request: ServerRequest): void {
  const message = `Rejected unknown app-server request: ${request.method}`;
  context.actions.rejectServerRequest(request.id, -32601, message);
}

function rejectServerRequest(context: ChatInboundHandlerContext, request: ServerRequest, message: string): void {
  addSystemMessage(context, message);
  if (!context.actions.rejectServerRequest(request.id, -32601, message)) {
    addSystemMessage(context, cannotRejectServerRequestMessage());
  }
}

function localItemId(context: ChatInboundHandlerContext, prefix: string): string {
  return context.localItemIds.next(prefix);
}

function runNotificationEffect(context: ChatInboundHandlerContext, effect: ChatNotificationEffect): void {
  switch (effect.type) {
    case "refresh-threads":
      context.actions.refreshActiveThreads();
      return;
    case "refresh-rate-limits":
      context.actions.refreshRateLimits();
      return;
    case "refresh-skills":
      context.actions.refreshSkills(effect.forceReload);
      return;
    case "apply-app-server-metadata-snapshot":
      context.actions.applyAppServerMetadataSnapshot();
      return;
    case "maybe-name-thread":
      context.actions.maybeNameThread(effect.threadId, effect.turnId, effect.completedSummary);
      return;
    case "record-thread-started":
      context.actions.recordThreadStarted(effect.thread);
      return;
    case "apply-thread-archived":
      context.actions.applyThreadArchived(effect.threadId);
      return;
    case "record-active-thread-deleted":
      context.actions.recordActiveThreadDeleted(effect.threadId);
      return;
    case "apply-thread-renamed":
      context.actions.applyThreadRenamed(effect.threadId, effect.name);
      return;
    case "record-mcp-startup-status":
      context.actions.recordMcpStartupStatus(effect.name, effect.status, effect.message);
      return;
  }
}
