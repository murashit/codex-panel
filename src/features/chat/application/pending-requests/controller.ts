import type { ChatStateStore } from "../state/store";
import { pendingRequestFocusSignature } from "../../domain/pending-requests/signatures";
import { pendingRequestBlockState } from "./snapshot";
import {
  answersForPendingUserInput,
  type ApprovalAction,
  type PendingApproval,
  type PendingUserInput,
} from "../../domain/pending-requests/model";
import type { PendingRequestBlockActions, PendingRequestBlockState, PendingRequestId } from "./block";

interface PendingRequestResponder {
  resolveApproval: (approval: PendingApproval, action: ApprovalAction) => void;
  resolveUserInput: (input: PendingUserInput, answers: Record<string, string>) => void;
  cancelUserInput: (input: PendingUserInput) => void;
}

export interface PendingRequestControllerHost {
  stateStore: ChatStateStore;
  responder: PendingRequestResponder;
  composerHasFocus: () => boolean;
  refreshLiveState: () => void;
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
    setApprovalDetailsExpanded: (requestId, expanded) => {
      this.host.stateStore.dispatch({
        type: "ui/disclosure-set",
        bucket: "approvalDetails",
        id: `${String(requestId)}:details`,
        open: expanded,
      });
    },
    setUserInputDraft: (key, value) => {
      this.host.stateStore.dispatch({ type: "request/user-input-draft-set", key, value });
    },
  };

  constructor(private readonly host: PendingRequestControllerHost) {}

  snapshot(): PendingRequestBlockState {
    return pendingRequestBlockState(this.host.stateStore.getState());
  }

  actions(): PendingRequestBlockActions {
    return this.blockActions;
  }

  resolveApproval(requestId: PendingRequestId, action: ApprovalAction): void {
    const approval = this.pendingApproval(requestId);
    if (!approval) return;
    this.host.responder.resolveApproval(approval, action);
    this.commitRequestAction();
  }

  resolveUserInput(requestId: PendingRequestId): void {
    const input = this.pendingUserInput(requestId);
    if (!input) return;
    this.host.responder.resolveUserInput(
      input,
      answersForPendingUserInput(input, pendingRequestBlockState(this.host.stateStore.getState()).userInputDrafts),
    );
    this.commitRequestAction();
  }

  cancelUserInput(requestId: PendingRequestId): void {
    const input = this.pendingUserInput(requestId);
    if (!input) return;
    this.host.responder.cancelUserInput(input);
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
