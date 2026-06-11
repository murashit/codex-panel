import type { RequestId } from "../../../../generated/app-server/RequestId";
import type { ServerNotification } from "../../../../generated/app-server/ServerNotification";
import type { ServerRequest } from "../../../../generated/app-server/ServerRequest";
import type { Turn } from "../../../../generated/app-server/v2/Turn";
import type { McpServerStartupStatus } from "../../../../app-server/diagnostics";
import { classifyAppServerLog } from "./app-server-logs";
import { activeTurnId, type ChatAction, type ChatState, type ChatStateStore } from "../../state/reducer";
import { createStructuredSystemItem, createSystemItem } from "../../display/system";
import type { DisplayDetailSection } from "../../display/types";
import { approvalResponse, type ApprovalAction, type PendingApproval } from "../requests/approval";
import { userInputResponse, type PendingUserInput } from "../requests/user-input";
import { createApprovalResultItem, createUserInputResultItem } from "../../pending-requests/view-model";
import { planChatNotification, type ChatNotificationEffect } from "./notification-plan";
import { routeServerRequest } from "./routing";

export interface ChatInboundControllerActions {
  refreshThreads: () => void;
  refreshRateLimits: () => void;
  refreshSkills: (forceReload?: boolean) => void;
  publishAppServerMetadata: () => void;
  maybeNameThread: (threadId: string, turn: Turn) => void;
  notifyThreadArchived: (threadId: string) => void;
  notifyThreadRenamed: (threadId: string, name: string | null) => void;
  recordMcpStartupStatus: (name: string, status: McpServerStartupStatus, message: string | null) => void;
  respondToServerRequest: (requestId: RequestId, result: unknown) => boolean;
  rejectServerRequest: (requestId: RequestId, code: number, message: string) => boolean;
}

export class ChatInboundController {
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
    if (!this.state.requests.approvals.some((item) => item.requestId === approval.requestId)) return;
    if (!this.actions.respondToServerRequest(approval.requestId, approvalResponse(approval, action))) {
      this.addSystemMessage("Could not send approval response because Codex app-server is not connected.");
      return;
    }
    this.dispatch({ type: "request/resolved", requestId: approval.requestId, resultItem: createApprovalResultItem(approval, action) });
  }

  resolveUserInput(input: PendingUserInput, answers: Record<string, string>): void {
    if (!this.state.requests.pendingUserInputs.some((item) => item.requestId === input.requestId)) return;
    if (!this.actions.respondToServerRequest(input.requestId, userInputResponse(input, answers))) {
      this.addSystemMessage("Could not send user input because Codex app-server is not connected.");
      return;
    }
    this.dispatch({
      type: "request/resolved",
      requestId: input.requestId,
      resultItem: createUserInputResultItem(input, answers, "submitted"),
    });
  }

  cancelUserInput(input: PendingUserInput): void {
    if (!this.state.requests.pendingUserInputs.some((item) => item.requestId === input.requestId)) return;
    if (!this.actions.rejectServerRequest(input.requestId, -32000, "User cancelled input request.")) {
      this.addSystemMessage("Could not cancel user input because Codex app-server is not connected.");
      return;
    }
    this.dispatch({ type: "request/resolved", requestId: input.requestId, resultItem: createUserInputResultItem(input, {}, "cancelled") });
  }

  addSystemMessage(text: string): void {
    this.dispatch({ type: "transcript/system-message-added", item: createSystemItem(this.localItemId("system"), text) });
  }

  addStructuredSystemMessage(text: string, details: DisplayDetailSection[]): void {
    this.dispatch({ type: "transcript/system-message-added", item: createStructuredSystemItem(this.localItemId("system"), text, details) });
  }

  addDedupedSystemMessage(text: string): void {
    this.dispatch({ type: "transcript/deduped-log-added", text, item: createSystemItem(this.localItemId("system"), text) });
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

  private rejectServerRequest(request: ServerRequest, message: string): void {
    this.addSystemMessage(message);
    if (!this.actions.rejectServerRequest(request.id, -32601, message)) {
      this.addSystemMessage("Could not reject app-server request because Codex app-server is not connected.");
    }
  }

  private localItemId(prefix: string): string {
    return `${prefix}-${String(Date.now())}-${Math.random().toString(36).slice(2)}`;
  }

  private runNotificationEffect(effect: ChatNotificationEffect): void {
    switch (effect.type) {
      case "refresh-threads":
        this.actions.refreshThreads();
        return;
      case "refresh-rate-limits":
        this.actions.refreshRateLimits();
        return;
      case "refresh-skills":
        this.actions.refreshSkills(effect.forceReload);
        return;
      case "publish-app-server-metadata":
        this.actions.publishAppServerMetadata();
        return;
      case "maybe-name-thread":
        this.actions.maybeNameThread(effect.threadId, effect.turn);
        return;
      case "notify-thread-archived":
        this.actions.notifyThreadArchived(effect.threadId);
        return;
      case "notify-thread-renamed":
        this.actions.notifyThreadRenamed(effect.threadId, effect.name);
        return;
      case "record-mcp-startup-status":
        this.actions.recordMcpStartupStatus(effect.name, effect.status, effect.message);
        return;
    }
  }
}
