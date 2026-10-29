import { answersForPendingUserInput, contentForPendingMcpElicitation } from "../../domain/pending-requests/drafts";
import {
  type ApprovalAction,
  type McpElicitationAction,
  type McpElicitationContentValue,
  NON_BLOCKING_USER_INPUT_AUTO_RESOLUTION_MS,
  type PendingApproval,
  type PendingMcpElicitation,
  type PendingRequestId,
  type PendingUserInput,
} from "../../domain/pending-requests/model";
import {
  createApprovalResultItem,
  createMcpElicitationResultItem,
  createUserInputResultItem,
} from "../../domain/pending-requests/result-items";
import type { ChatStateStore } from "../state/store";
import { activeTurnId } from "../turns/turn-state";

export interface PendingRequestResponsePort {
  respondApproval(requestId: PendingRequestId, action: ApprovalAction): boolean;
  respondUserInput(requestId: PendingRequestId, answers: Record<string, string> | null): boolean;
  cancelUserInput(requestId: PendingRequestId): boolean;
  respondMcpElicitation(
    requestId: PendingRequestId,
    action: McpElicitationAction,
    content: Record<string, McpElicitationContentValue> | null,
  ): boolean;
}

interface PendingRequestsHost {
  stateStore: ChatStateStore;
  responses: PendingRequestResponsePort;
  addSystemMessage(text: string): void;
}

export class PendingRequests {
  private readonly userInputTimers = new Map<PendingRequestId, number>();

  constructor(private readonly host: PendingRequestsHost) {}

  queueApproval(approval: PendingApproval): void {
    this.host.stateStore.dispatch({ type: "request/approval-queued", approval });
  }

  queueUserInput(input: PendingUserInput): void {
    const pending = input.params.isBlocking
      ? input
      : { ...input, autoResolutionAtMs: Date.now() + NON_BLOCKING_USER_INPUT_AUTO_RESOLUTION_MS };
    this.host.stateStore.dispatch({ type: "request/user-input-queued", input: pending });
    if (!pending.params.isBlocking) this.scheduleUserInputAutoResolution(pending);
  }

  queueMcpElicitation(elicitation: PendingMcpElicitation): void {
    this.host.stateStore.dispatch({ type: "request/mcp-elicitation-queued", elicitation });
  }

  reconcile(): void {
    const state = this.host.stateStore.getState();
    const turnId = activeTurnId(state.activeTurn);
    for (const approval of state.requests.approvals) {
      if (approval.turnId !== turnId) this.resolve(approval.requestId);
    }
    for (const requestId of this.userInputTimers.keys()) {
      if (!this.pendingUserInput(requestId)) this.clearUserInputTimer(requestId);
    }
  }

  resolve(requestId: PendingRequestId): void {
    this.clearUserInputTimer(requestId);
    this.host.stateStore.dispatch({ type: "request/resolved", requestId });
  }

  clear(): void {
    for (const requestId of this.userInputTimers.keys()) this.clearUserInputTimer(requestId);
  }

  // Response actions report whether a pending request was acted on, including a failed delivery.
  // The host restores composer focus after an attempt; failures keep the request and its draft.
  resolveApproval(requestId: PendingRequestId, action: ApprovalAction): boolean {
    this.reconcile();
    const approval = this.state.approvals.find((item) => item.requestId === requestId);
    if (!approval) return false;
    if (!this.host.responses.respondApproval(requestId, action)) {
      this.host.addSystemMessage("Could not send approval response because Codex app-server is not connected.");
      return true;
    }
    this.host.stateStore.dispatch({ type: "request/resolved", requestId, resultItem: createApprovalResultItem(approval, action) });
    return true;
  }

  resolveUserInput(requestId: PendingRequestId): boolean {
    const input = this.pendingUserInput(requestId);
    if (!input) return false;
    const answers = answersForPendingUserInput(input, this.state.userInputDrafts);
    if (!this.host.responses.respondUserInput(requestId, answers)) {
      this.host.addSystemMessage("Could not send user input because Codex app-server is not connected.");
      return true;
    }
    this.clearUserInputTimer(requestId);
    this.host.stateStore.dispatch({
      type: "request/resolved",
      requestId,
      resultItem: createUserInputResultItem(input, answers, "submitted"),
    });
    return true;
  }

  cancelUserInput(requestId: PendingRequestId): boolean {
    const input = this.pendingUserInput(requestId);
    if (!input) return false;
    if (!this.host.responses.cancelUserInput(requestId)) {
      this.host.addSystemMessage("Could not cancel user input because Codex app-server is not connected.");
      return true;
    }
    this.clearUserInputTimer(requestId);
    this.host.stateStore.dispatch({ type: "request/resolved", requestId, resultItem: createUserInputResultItem(input, {}, "cancelled") });
    return true;
  }

  skipUserInput(requestId: PendingRequestId): boolean {
    const input = this.pendingUserInput(requestId);
    if (!input || input.params.isBlocking) return false;
    if (!this.host.responses.respondUserInput(requestId, null)) {
      this.host.addSystemMessage("Could not skip user input because Codex app-server is not connected.");
      return true;
    }
    this.resolve(requestId);
    return true;
  }

  setUserInputDraft(requestId: PendingRequestId, key: string, value: string): void {
    this.host.stateStore.dispatch({ type: "request/user-input-draft-set", key, value });
    const input = this.pendingUserInput(requestId);
    if (!input || input.params.isBlocking) return;
    const autoResolutionAtMs = Date.now() + NON_BLOCKING_USER_INPUT_AUTO_RESOLUTION_MS;
    this.host.stateStore.dispatch({ type: "request/user-input-auto-resolution-extended", requestId, autoResolutionAtMs });
    this.scheduleUserInputAutoResolution({ ...input, autoResolutionAtMs });
  }

  setMcpElicitationDraft(key: string, value: string): void {
    this.host.stateStore.dispatch({ type: "request/mcp-elicitation-draft-set", key, value });
  }

  resolveMcpElicitation(requestId: PendingRequestId, action: McpElicitationAction): boolean {
    const elicitation = this.state.pendingMcpElicitations.find((item) => item.requestId === requestId);
    if (!elicitation) return false;
    const content = action === "accept" ? contentForPendingMcpElicitation(elicitation, this.state.mcpElicitationDrafts) : null;
    if (!this.host.responses.respondMcpElicitation(requestId, action, content)) {
      this.host.addSystemMessage("Could not send MCP request response because Codex app-server is not connected.");
      return true;
    }
    this.host.stateStore.dispatch({
      type: "request/resolved",
      requestId,
      resultItem: createMcpElicitationResultItem(elicitation, action, content),
    });
    return true;
  }

  private get state() {
    return this.host.stateStore.getState().requests;
  }

  private pendingUserInput(requestId: PendingRequestId): PendingUserInput | undefined {
    return this.state.pendingUserInputs.find((input) => input.requestId === requestId);
  }

  private scheduleUserInputAutoResolution(input: PendingUserInput): void {
    this.clearUserInputTimer(input.requestId);
    const delayMs = Math.max(0, (input.autoResolutionAtMs ?? Date.now()) - Date.now());
    const timer = window.setTimeout(() => {
      this.userInputTimers.delete(input.requestId);
      if (!this.pendingUserInput(input.requestId)) return;
      if (!this.host.responses.respondUserInput(input.requestId, null)) {
        this.host.addSystemMessage("Could not auto-resolve user input because Codex app-server is not connected.");
        return;
      }
      this.resolve(input.requestId);
    }, delayMs);
    this.userInputTimers.set(input.requestId, timer);
  }

  private clearUserInputTimer(requestId: PendingRequestId): void {
    const timer = this.userInputTimers.get(requestId);
    if (timer === undefined) return;
    window.clearTimeout(timer);
    this.userInputTimers.delete(requestId);
  }
}
