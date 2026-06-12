import type { ChatStateStore } from "../../state/reducer";
import type { ApprovalAction, PendingApproval } from "../../protocol/server-requests/approval";
import type { ChatInboundController } from "../../protocol/inbound/controller";
import { pendingRequestFocusSignature } from "./signatures";
import { pendingRequestBlockSnapshot, type PendingRequestBlockSnapshot } from "./snapshot";
import { answersForPendingUserInput, type PendingUserInput } from "../../protocol/server-requests/user-input";
import type { PendingRequestBlockActions, PendingRequestId } from "./view-model";

export interface PendingRequestControllerHost {
  stateStore: ChatStateStore;
  controller: ChatInboundController;
  composerHasFocus: () => boolean;
  refreshLiveState: () => void;
  render: () => void;
}

export class PendingRequestController {
  private lastFocusSignature = "";
  private readonly blockActions: PendingRequestBlockActions = {
    resolveApproval: (requestId, action) => {
      this.resolveApproval(requestId, action);
    },
    resolveUserInput: (requestId) => {
      this.resolveUserInput(requestId);
    },
    cancelUserInput: (requestId) => {
      this.cancelUserInput(requestId);
    },
    setOpenDetail: (key, open) => {
      this.host.stateStore.dispatch({ type: "ui/detail-open-set", key, open });
    },
    setUserInputDraft: (key, value) => {
      this.host.stateStore.dispatch({ type: "request/user-input-draft-set", key, value });
    },
  };

  constructor(private readonly host: PendingRequestControllerHost) {}

  snapshot(): PendingRequestBlockSnapshot {
    return pendingRequestBlockSnapshot(this.host.stateStore.getState());
  }

  actions(): PendingRequestBlockActions {
    return this.blockActions;
  }

  resolveApproval(requestId: PendingRequestId, action: ApprovalAction): void {
    const approval = this.pendingApproval(requestId);
    if (!approval) return;
    this.host.controller.resolveApproval(approval, action);
    this.commitRequestAction();
  }

  resolveUserInput(requestId: PendingRequestId): void {
    const input = this.pendingUserInput(requestId);
    if (!input) return;
    this.host.controller.resolveUserInput(
      input,
      answersForPendingUserInput(input, pendingRequestBlockSnapshot(this.host.stateStore.getState()).userInputDrafts),
    );
    this.commitRequestAction();
  }

  cancelUserInput(requestId: PendingRequestId): void {
    const input = this.pendingUserInput(requestId);
    if (!input) return;
    this.host.controller.cancelUserInput(input);
    this.commitRequestAction();
  }

  private pendingApproval(requestId: PendingRequestId): PendingApproval | null {
    return this.host.stateStore.getState().requests.approvals.find((approval) => approval.requestId === requestId) ?? null;
  }

  private pendingUserInput(requestId: PendingRequestId): PendingUserInput | null {
    return this.host.stateStore.getState().requests.pendingUserInputs.find((input) => input.requestId === requestId) ?? null;
  }

  private commitRequestAction(): void {
    this.host.refreshLiveState();
    this.host.render();
  }

  consumeAutoFocus(): boolean {
    const state = this.host.stateStore.getState();
    const signature = pendingRequestFocusSignature(state.requests.approvals, state.requests.pendingUserInputs);
    if (!signature) {
      this.lastFocusSignature = "";
      return false;
    }
    if (signature === this.lastFocusSignature) return false;
    this.lastFocusSignature = signature;
    return this.host.composerHasFocus();
  }
}
