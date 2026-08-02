import type { RequestId, ServerNotification, ServerRequest } from "../../../../app-server/connection/rpc-messages";
import type { TurnTranscriptSummary } from "../../../../domain/threads/transcript";
import type { ThreadFact } from "../../../threads/workflows/thread-facts";
import type { AppServerResourceFact } from "../../application/connection/server-metadata-effects";
import type { LocalIdSource } from "../../application/local-id-source";
import { activeThreadId, type ChatAction, type ChatState } from "../../application/state/root-reducer";
import type { ChatStateStore } from "../../application/state/store";
import { activeTurnId } from "../../application/turns/turn-state";
import { contentForPendingMcpElicitation } from "../../domain/pending-requests/drafts";
import type { ApprovalAction, McpElicitationAction, PendingRequestId, PendingUserInput } from "../../domain/pending-requests/model";
import {
  createApprovalResultItem,
  createMcpElicitationResultItem,
  createUserInputResultItem,
} from "../../domain/pending-requests/result-items";
import { createStructuredSystemItem, createSystemItem } from "../../domain/thread-stream/factories/system-items";
import type { ThreadStreamNoticeSection } from "../../domain/thread-stream/items";
import { classifyAppServerLog } from "./app-server-logs";
import {
  type ApprovalRequestOwner,
  type ApprovalResponseDelivery,
  createApprovalRequestCoordinator,
  isApprovalServerRequest,
} from "./approval-request-coordinator";
import { type ChatInboundEffect, planChatInboundNotification } from "./notification-plan";
import {
  routeServerRequest,
  serverRequestCurrentTimeResponse,
  serverRequestMcpElicitationResponse,
  serverRequestUserInputResponse,
} from "./server-request-routing";

export interface ChatInboundHandlerEffects {
  refreshServerDiagnostics: () => void;
  handleAppServerResourceFact: (fact: AppServerResourceFact) => void;
  maybeNameThread: (threadId: string, turnId: string, completedTurnTranscriptSummary: TurnTranscriptSummary | null) => void;
  applyThreadFact: (fact: ThreadFact) => void;
  observeThreadGoal: (threadId: string) => void;
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
  clearServerRequests(): void;
  addSystemMessage(text: string): void;
  addStructuredSystemMessage(text: string, details: ThreadStreamNoticeSection[]): void;
  addDedupedSystemMessage(text: string): void;
}

interface ChatInboundHandlerContext {
  store: ChatStateStore;
  effects: ChatInboundHandlerEffects;
  localItemIds: LocalIdSource;
  approvalRequests: ReturnType<typeof createApprovalRequestCoordinator>;
}

export function createChatInboundHandler(
  store: ChatStateStore,
  effects: ChatInboundHandlerEffects,
  localItemIds: LocalIdSource,
): ChatInboundHandler {
  const context: ChatInboundHandlerContext = {
    store,
    effects,
    localItemIds,
    approvalRequests: createApprovalRequestCoordinator(),
  };
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
    clearServerRequests: () => {
      context.approvalRequests.clear();
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
  reconcileApprovalRequests(context);
  flushAutomaticApprovalResponses(context);
  if (notification.method === "serverRequest/resolved") {
    const settlement = context.approvalRequests.markSettled(notification.params.requestId);
    if (settlement) {
      if (!settlement.uiResolved && settlement.allKnownEndpointsSettled) {
        dispatch(context, { type: "request/resolved", requestId: settlement.logicalRequestId });
      }
      reconcileApprovalRequests(context);
      return;
    }
  }
  if (notification.method === "thread/goal/updated" || notification.method === "thread/goal/cleared") {
    context.effects.observeThreadGoal(notification.params.threadId);
  }
  const plan = planChatInboundNotification(state(context), notification, (prefix) => localItemId(context, prefix));
  for (const action of plan.actions) dispatch(context, action);
  for (const effect of plan.effects) runInboundEffect(context, effect);
  reconcileApprovalRequests(context);
}

function handleServerRequest(context: ChatInboundHandlerContext, request: ServerRequest): void {
  reconcileApprovalRequests(context);
  flushAutomaticApprovalResponses(context);
  const current = state(context);
  const activeScope = { activeThreadId: activeThreadId(current), activeTurnId: activeTurnId(current.activeTurn) };
  let route = routeServerRequest(request, activeScope);
  let approvalOwner: ApprovalRequestOwner = "active";
  if (route.kind === "inactive") {
    const trackedScope = trackedSubagentApprovalScope(current, request);
    if (trackedScope) {
      route = routeServerRequest(request, trackedScope);
      approvalOwner = "tracked-subagent";
    }
  }
  switch (route.kind) {
    case "approval": {
      if (!isApprovalServerRequest(request)) {
        rejectServerRequest(context, request, `Rejected unsupported app-server request: ${request.method}`);
        return;
      }
      const parentTurnId = activeTurnId(current.activeTurn) ?? route.approval.turnId;
      if (!parentTurnId) {
        rejectServerRequest(context, request, `Rejected approval without a turn: ${request.method}`);
        return;
      }
      const registration = context.approvalRequests.register(request, approvalOwner, parentTurnId);
      if (registration.kind === "new") {
        const approval = approvalOwner === "tracked-subagent" ? { ...route.approval, turnId: parentTurnId } : route.approval;
        dispatch(context, { type: "request/approval-queued", approval });
      } else if (registration.kind === "answered") {
        deliverApprovalResponses(context, registration.deliveries);
      }
      return;
    }
    case "userInput":
      dispatch(context, { type: "request/user-input-queued", input: route.input });
      return;
    case "mcpElicitation":
      dispatch(context, { type: "request/mcp-elicitation-queued", elicitation: route.elicitation });
      return;
    case "currentTime":
      if (!context.effects.respondToServerRequest(route.request.id, serverRequestCurrentTimeResponse(Date.now()))) {
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
      context.effects.rejectServerRequest(request.id, -32601, message);
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
  const plan = context.approvalRequests.decide(approval.requestId, action);
  if (!plan) {
    addSystemMessage(context, "Could not find the approval request to answer.");
    return;
  }
  const delivered = deliverApprovalResponses(context, plan.deliveries);
  if (!delivered) {
    addSystemMessage(context, "Could not send approval response because Codex app-server is not connected.");
    return;
  }
  context.approvalRequests.markUiResolved(approval.requestId);
  dispatch(context, {
    type: "request/resolved",
    requestId: approval.requestId,
    resultItem: createApprovalResultItem(approval, plan.action),
  });
}

function trackedSubagentApprovalScope(current: ChatState, request: ServerRequest): { activeThreadId: string; activeTurnId: string } | null {
  if (!isApprovalServerRequest(request)) return null;
  const parentTurnId = activeTurnId(current.activeTurn);
  const tracked = current.activeTurn.subagents.byThreadId.get(request.params.threadId);
  if (!parentTurnId || !tracked?.childTurnId || tracked.childTurnId !== request.params.turnId || tracked.liveness !== "running") {
    return null;
  }
  return { activeThreadId: tracked.threadId, activeTurnId: tracked.childTurnId };
}

function deliverApprovalResponses(context: ChatInboundHandlerContext, deliveries: readonly ApprovalResponseDelivery[]): boolean {
  let delivered = false;
  for (const delivery of deliveries) {
    if (!context.effects.respondToServerRequest(delivery.requestId, delivery.response)) continue;
    delivered = true;
    context.approvalRequests.markSettled(delivery.requestId);
  }
  return delivered;
}

function flushAutomaticApprovalResponses(context: ChatInboundHandlerContext): void {
  const deliveries = context.approvalRequests.automaticDeliveries();
  if (deliveries.length > 0) deliverApprovalResponses(context, deliveries);
}

function reconcileApprovalRequests(context: ChatInboundHandlerContext): void {
  const current = state(context);
  const pendingApprovalIds = new Set(current.requests.approvals.map((approval) => approval.requestId));
  const abandonedApprovalIds = context.approvalRequests.reconcile(activeTurnId(current.activeTurn), pendingApprovalIds);
  for (const requestId of abandonedApprovalIds) {
    if (pendingApprovalIds.has(requestId)) dispatch(context, { type: "request/resolved", requestId });
  }
}

function resolveUserInput(context: ChatInboundHandlerContext, requestId: PendingRequestId, answers: Record<string, string>): void {
  const input = pendingUserInput(context, requestId);
  if (!input) return;
  if (!context.effects.respondToServerRequest(input.requestId, serverRequestUserInputResponse(input.params.questions, answers))) {
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
  if (!context.effects.rejectServerRequest(input.requestId, -32000, "User cancelled input request.")) {
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
  if (!context.effects.respondToServerRequest(elicitation.requestId, serverRequestMcpElicitationResponse(action, content))) {
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
  if (!context.effects.rejectServerRequest(request.id, -32601, message)) {
    addSystemMessage(context, "Could not reject app-server request because Codex app-server is not connected.");
  }
}

function localItemId(context: ChatInboundHandlerContext, prefix: string): string {
  return context.localItemIds.next(prefix);
}

function runInboundEffect(context: ChatInboundHandlerContext, effect: ChatInboundEffect): void {
  switch (effect.type) {
    case "refresh-server-diagnostics":
      context.effects.refreshServerDiagnostics();
      return;
    case "handle-app-server-resource-fact":
      context.effects.handleAppServerResourceFact(effect.fact);
      return;
    case "maybe-name-thread":
      context.effects.maybeNameThread(effect.threadId, effect.turnId, effect.completedTurnTranscriptSummary);
      return;
    case "apply-thread-fact":
      context.effects.applyThreadFact(effect.fact);
      return;
  }
}
