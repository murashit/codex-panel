import type { RequestId, ServerNotification, ServerRequest } from "../../../../app-server/connection/rpc-messages";
import type { McpServerStartupStatus } from "../../../../domain/server/diagnostics";
import type { ThreadConversationSummary } from "../../../../domain/threads/transcript";
import { classifyAppServerLog } from "./app-server-logs";
import { activeTurnId, type ChatAction, type ChatState } from "../../application/state/root-reducer";
import type { ChatStateStore } from "../../application/state/store";
import type { MessageStreamNoticeSection } from "../../domain/message-stream/items";
import { createStructuredSystemItem, createSystemItem } from "../../domain/message-stream/factories/system-items";
import type { ApprovalAction, PendingApproval, PendingUserInput } from "../../domain/pending-requests/model";
import { approvalResponse } from "../requests/approval";
import { userInputResponse } from "../requests/user-input";
import { createApprovalResultItem, createUserInputResultItem } from "../../domain/pending-requests/result-items";
import { createLocalChatItemIdFactory, type LocalChatItemIdFactory } from "../../domain/local-id";
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

function userCancelledInputRequestMessage(): string {
  return "User cancelled input request.";
}

function cannotRejectServerRequestMessage(): string {
  return "Could not reject app-server request because Codex app-server is not connected.";
}

export interface ChatInboundControllerActions {
  fetchActiveThreads: () => void;
  refreshRateLimits: () => void;
  refreshSkills: (forceReload?: boolean) => void;
  setAppServerMetadata: () => void;
  maybeNameThread: (threadId: string, turnId: string, completedSummary: ThreadConversationSummary | null) => void;
  applyThreadArchived: (threadId: string) => void;
  applyThreadRenamed: (threadId: string, name: string | null) => void;
  recordMcpStartupStatus: (name: string, status: McpServerStartupStatus, message: string | null) => void;
  respondToServerRequest: (requestId: RequestId, result: unknown) => boolean;
  rejectServerRequest: (requestId: RequestId, code: number, message: string) => boolean;
}

export class ChatInboundController {
  private readonly localItemIds: LocalChatItemIdFactory = createLocalChatItemIdFactory();

  constructor(
    private readonly store: ChatStateStore,
    private readonly actions: ChatInboundControllerActions,
  ) {}

  private get state(): ChatState {
    return this.store.getState();
  }

  private dispatch(action: ChatAction): void {
    this.store.dispatch(action);
  }

  handleNotification(notification: ServerNotification): void {
    const plan = planChatNotification(this.state, notification, (prefix) => this.localItemId(prefix));
    for (const action of plan.actions) this.dispatch(action);
    for (const effect of plan.effects) this.runNotificationEffect(effect);
  }

  handleServerRequest(request: ServerRequest): void {
    const route = routeServerRequest(request, this.activeRouteScope());
    switch (route.kind) {
      case "approval":
        this.queueApprovalRequest(route.approval);
        return;
      case "userInput":
        this.queueUserInputRequest(route.input);
        return;
      case "inactive":
        this.rejectServerRequest(request, `Rejected inactive app-server request: ${request.method}`);
        return;
      case "unsupported":
        this.rejectUnsupportedServerRequest(request);
        return;
      case "unknown":
        this.rejectUnknownServerRequest(request);
        return;
    }
  }

  handleAppServerLog(message: string): void {
    const classified = classifyAppServerLog(message);
    if (classified === null) return;
    if (classified.kind === "plain") {
      this.addDedupedSystemMessage(classified.text);
    } else {
      this.addDedupedSystemMessage(`app-server error: ${classified.text}`);
    }
  }

  resolveApproval(approval: PendingApproval, action: ApprovalAction): void {
    if (!this.state.requests.approvals.includes(approval)) return;
    if (!this.actions.respondToServerRequest(approval.requestId, approvalResponse(approval, action))) {
      this.addSystemMessage(cannotSendApprovalResponseMessage());
      return;
    }
    this.dispatch({ type: "request/resolved", requestId: approval.requestId, resultItem: createApprovalResultItem(approval, action) });
  }

  resolveUserInput(input: PendingUserInput, answers: Record<string, string>): void {
    if (!this.state.requests.pendingUserInputs.includes(input)) return;
    if (!this.actions.respondToServerRequest(input.requestId, userInputResponse(input, answers))) {
      this.addSystemMessage(cannotSendUserInputMessage());
      return;
    }
    this.dispatch({
      type: "request/resolved",
      requestId: input.requestId,
      resultItem: createUserInputResultItem(input, answers, "submitted"),
    });
  }

  cancelUserInput(input: PendingUserInput): void {
    if (!this.state.requests.pendingUserInputs.includes(input)) return;
    if (!this.actions.rejectServerRequest(input.requestId, -32000, userCancelledInputRequestMessage())) {
      this.addSystemMessage(cannotCancelUserInputMessage());
      return;
    }
    this.dispatch({ type: "request/resolved", requestId: input.requestId, resultItem: createUserInputResultItem(input, {}, "cancelled") });
  }

  addSystemMessage(text: string): void {
    this.dispatch({ type: "message-stream/system-item-added", item: createSystemItem(this.localItemId("system"), text) });
  }

  addStructuredSystemMessage(text: string, details: MessageStreamNoticeSection[]): void {
    this.dispatch({
      type: "message-stream/system-item-added",
      item: createStructuredSystemItem(this.localItemId("system"), text, details),
    });
  }

  addDedupedSystemMessage(text: string): void {
    this.dispatch({ type: "message-stream/deduped-log-added", text, item: createSystemItem(this.localItemId("system"), text) });
  }

  private queueApprovalRequest(approval: PendingApproval): void {
    this.dispatch({ type: "request/approval-queued", approval });
  }

  private queueUserInputRequest(userInput: PendingUserInput): void {
    this.dispatch({ type: "request/user-input-queued", input: userInput });
  }

  private activeRouteScope(): { activeThreadId: string | null; activeTurnId: string | null } {
    return {
      activeThreadId: this.state.activeThread.id,
      activeTurnId: activeTurnId(this.state),
    };
  }

  private rejectUnsupportedServerRequest(request: ServerRequest): void {
    const message = `Rejected unsupported app-server request: ${request.method}`;
    this.rejectServerRequest(request, message);
  }

  private rejectUnknownServerRequest(request: ServerRequest): void {
    const message = `Rejected unknown app-server request: ${request.method}`;
    this.actions.rejectServerRequest(request.id, -32601, message);
  }

  private rejectServerRequest(request: ServerRequest, message: string): void {
    this.addSystemMessage(message);
    if (!this.actions.rejectServerRequest(request.id, -32601, message)) {
      this.addSystemMessage(cannotRejectServerRequestMessage());
    }
  }

  private localItemId(prefix: string): string {
    return this.localItemIds.next(prefix);
  }

  private runNotificationEffect(effect: ChatNotificationEffect): void {
    switch (effect.type) {
      case "refresh-threads":
        this.actions.fetchActiveThreads();
        return;
      case "refresh-rate-limits":
        this.actions.refreshRateLimits();
        return;
      case "refresh-skills":
        this.actions.refreshSkills(effect.forceReload);
        return;
      case "publish-app-server-metadata":
        this.actions.setAppServerMetadata();
        return;
      case "maybe-name-thread":
        this.actions.maybeNameThread(effect.threadId, effect.turnId, effect.completedSummary);
        return;
      case "apply-thread-archived":
        this.actions.applyThreadArchived(effect.threadId);
        return;
      case "apply-thread-renamed":
        this.actions.applyThreadRenamed(effect.threadId, effect.name);
        return;
      case "record-mcp-startup-status":
        this.actions.recordMcpStartupStatus(effect.name, effect.status, effect.message);
        return;
    }
  }
}
