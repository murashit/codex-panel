import type { AppServerServerRequestResponder } from "../../../../app-server/connection/client";
import type { RequestId, ServerRequest } from "../../../../app-server/connection/rpc-messages";
import type { DynamicToolCallResponse } from "../../../../generated/app-server/v2/DynamicToolCallResponse";
import { dynamicToolFailure, type PanelDynamicToolCall, type PanelDynamicToolResponse } from "../../application/dynamic-tools";
import { type PendingRequestResponsePort, PendingRequests } from "../../application/pending-requests/controller";
import { activeThreadId, type ChatState } from "../../application/state/model";
import type { ChatStateStore } from "../../application/state/store";
import { activeTurnId } from "../../application/turns/turn-state";
import {
  appServerApprovalResponse,
  appServerMcpElicitationResponse,
  appServerUserInputResponse,
  isApprovalServerRequest,
} from "./server-request-adapter";
import { routeServerRequest, serverRequestCurrentTimeResponse } from "./server-request-routing";

interface ServerRequestsHost {
  stateStore: ChatStateStore;
  addSystemMessage(text: string): void;
  executeDynamicTool(call: PanelDynamicToolCall): PanelDynamicToolResponse;
}

interface ServerRequestEntry {
  readonly request: ServerRequest;
  readonly responder: AppServerServerRequestResponder;
}

export class ChatServerRequests {
  readonly pending: PendingRequests;
  // Retain the originating responder and opaque payload together, including replayed approvals.
  private readonly entries = new Map<RequestId, ServerRequestEntry>();

  constructor(private readonly host: ServerRequestsHost) {
    const responses: PendingRequestResponsePort = {
      respondApproval: (requestId, action) => {
        const request = this.entries.get(requestId)?.request;
        return Boolean(request && isApprovalServerRequest(request) && this.respond(requestId, appServerApprovalResponse(request, action)));
      },
      respondUserInput: (requestId, answers) => {
        const request = this.entries.get(requestId)?.request;
        return (
          request?.method === "item/tool/requestUserInput" &&
          this.respond(requestId, answers === null ? { answers: {} } : appServerUserInputResponse(request.params.questions, answers))
        );
      },
      cancelUserInput: (requestId) => this.reject(requestId, -32000, "User cancelled input request."),
      respondMcpElicitation: (requestId, action, content) => this.respond(requestId, appServerMcpElicitationResponse(action, content)),
    };
    this.pending = new PendingRequests({
      stateStore: host.stateStore,
      responses,
      addSystemMessage: (text) => {
        host.addSystemMessage(text);
      },
    });
  }

  handle(request: ServerRequest, responder: AppServerServerRequestResponder): boolean {
    this.pending.reconcile();
    const current = this.host.stateStore.getState();
    const activeScope = { activeThreadId: activeThreadId(current), activeTurnId: activeTurnId(current.activeTurn) };
    let route = routeServerRequest(request, activeScope);
    let trackedSubagent = false;
    if (route.kind === "inactive") {
      const trackedScope = trackedSubagentApprovalScope(current, request);
      if (trackedScope) {
        route = routeServerRequest(request, trackedScope);
        trackedSubagent = true;
      }
    }
    if (route.kind === "inactive") return false;
    this.entries.set(request.id, { request, responder });
    switch (route.kind) {
      case "approval": {
        const parentTurnId = activeTurnId(current.activeTurn) ?? route.approval.turnId;
        if (!parentTurnId) {
          this.rejectUnsupported(request, `Rejected approval without a turn: ${request.method}`);
          break;
        }
        this.pending.queueApproval(trackedSubagent ? { ...route.approval, turnId: parentTurnId } : route.approval);
        break;
      }
      case "userInput":
        this.pending.queueUserInput(route.input);
        break;
      case "mcpElicitation":
        this.pending.queueMcpElicitation(route.elicitation);
        break;
      case "currentTime":
        if (!this.respond(request.id, serverRequestCurrentTimeResponse(Date.now()))) {
          this.host.addSystemMessage("Could not send current time because Codex app-server is not connected.");
        }
        break;
      case "dynamicTool":
        this.respondToDynamicToolCall(request.id, route.request.params);
        break;
      case "unsupported":
        this.rejectUnsupported(
          request,
          request.method === "item/commandExecution/requestApproval"
            ? "Rejected command approval: availableDecisions must be a nonempty list of supported decisions."
            : `Rejected unsupported app-server request: ${request.method}`,
        );
        break;
      case "unknown":
        this.reject(request.id, -32601, `Rejected unknown app-server request: ${request.method}`);
        break;
    }
    return true;
  }

  resolved(requestId: RequestId): boolean {
    const entry = this.entries.get(requestId);
    this.entries.delete(requestId);
    // Child approvals are displayed in the parent panel, before ordinary thread routing.
    if (!entry || !isApprovalServerRequest(entry.request)) return false;
    this.pending.resolve(requestId);
    return true;
  }

  clear(reason: "disconnect" | "close" = "disconnect"): void {
    this.pending.clear();
    for (const [requestId, entry] of this.entries) {
      // Closing presentation is not an approval decision; Codex owns retention and resume replay.
      if (reason === "close" && isApprovalServerRequest(entry.request)) continue;
      this.reject(requestId, -32000, "Codex Panel disconnected before the request was answered.");
    }
    this.entries.clear();
  }

  private respond(requestId: RequestId, result: unknown): boolean {
    return this.settle(requestId, (responder) => {
      responder.respond(result);
    });
  }

  private reject(requestId: RequestId, code: number, message: string): boolean {
    return this.settle(requestId, (responder) => {
      responder.reject(code, message);
    });
  }

  private settle(requestId: RequestId, deliver: (responder: AppServerServerRequestResponder) => void): boolean {
    const entry = this.entries.get(requestId);
    if (!entry) return false;
    try {
      deliver(entry.responder);
      this.entries.delete(requestId);
      return true;
    } catch {
      return false;
    }
  }

  private rejectUnsupported(request: ServerRequest, message: string): void {
    this.host.addSystemMessage(message);
    if (!this.reject(request.id, -32601, message)) {
      this.host.addSystemMessage("Could not reject app-server request because Codex app-server is not connected.");
    }
  }

  private respondToDynamicToolCall(requestId: RequestId, call: PanelDynamicToolCall): void {
    let response: PanelDynamicToolResponse;
    try {
      response = this.host.executeDynamicTool(call);
    } catch (error) {
      response = dynamicToolFailure(error instanceof Error ? error.message : String(error));
    }
    const result: DynamicToolCallResponse = { success: response.success, contentItems: [...response.contentItems] };
    if (!this.respond(requestId, result)) {
      this.host.addSystemMessage("Could not send the dynamic tool response because Codex app-server is not connected.");
    }
  }
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
