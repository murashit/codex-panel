import type { ChatStateStore } from "../state/store";
import { pendingRequestFocusSignature } from "../../domain/pending-requests/signatures";
import {
  approvalDetailsDisclosureId,
  answersForPendingUserInput,
  type ApprovalAction,
  type PendingApproval,
  type PendingUserInput,
} from "../../domain/pending-requests/model";
import type { PendingRequestBlockActions, PendingRequestBlockState, PendingRequestId } from "./block";
import type { ChatState } from "../state/root-reducer";

interface PendingRequestResponder {
  resolveApproval: (approval: PendingApproval, action: ApprovalAction) => void;
  resolveUserInput: (input: PendingUserInput, answers: Record<string, string>) => void;
  cancelUserInput: (input: PendingUserInput) => void;
}

export interface PendingRequestActionsHost {
  stateStore: ChatStateStore;
  responder: PendingRequestResponder;
  composerHasFocus: () => boolean;
  refreshLiveState: () => void;
}

export interface PendingRequestActions {
  snapshot(): PendingRequestBlockState;
  actions(): PendingRequestBlockActions;
  resolveApproval(requestId: PendingRequestId, action: ApprovalAction): void;
  resolveUserInput(requestId: PendingRequestId): void;
  cancelUserInput(requestId: PendingRequestId): void;
  consumeAutoFocus(): boolean;
}

export function createPendingRequestActions(host: PendingRequestActionsHost): PendingRequestActions {
  let lastFocusSignature = "";

  const resolveApproval = (requestId: PendingRequestId, approvalAction: ApprovalAction): void => {
    const approval = pendingApproval(host, requestId);
    if (!approval) return;
    host.responder.resolveApproval(approval, approvalAction);
    commitRequestAction(host);
  };

  const resolveUserInput = (requestId: PendingRequestId): void => {
    const input = pendingUserInput(host, requestId);
    if (!input) return;
    host.responder.resolveUserInput(
      input,
      answersForPendingUserInput(input, pendingRequestBlockState(host.stateStore.getState()).userInputDrafts),
    );
    commitRequestAction(host);
  };

  const cancelUserInput = (requestId: PendingRequestId): void => {
    const input = pendingUserInput(host, requestId);
    if (!input) return;
    host.responder.cancelUserInput(input);
    commitRequestAction(host);
  };

  const blockActions: PendingRequestBlockActions = {
    resolveApproval: (requestId, approvalAction) => {
      resolveApproval(requestId, approvalAction);
    },
    resolveUserInput: (requestId) => {
      resolveUserInput(requestId);
    },
    cancelUserInput: (requestId) => {
      cancelUserInput(requestId);
    },
    setApprovalDetailsExpanded: (requestId, expanded) => {
      host.stateStore.dispatch({
        type: "ui/disclosure-set",
        bucket: "approvalDetails",
        id: approvalDetailsDisclosureId(requestId),
        open: expanded,
      });
    },
    setUserInputDraft: (key, value) => {
      host.stateStore.dispatch({ type: "request/user-input-draft-set", key, value });
    },
  };

  return {
    snapshot(): PendingRequestBlockState {
      return pendingRequestBlockState(host.stateStore.getState());
    },

    actions(): PendingRequestBlockActions {
      return blockActions;
    },

    resolveApproval,
    resolveUserInput,
    cancelUserInput,

    consumeAutoFocus(): boolean {
      const state = host.stateStore.getState();
      const signature = pendingRequestFocusSignature(state.requests.approvals, state.requests.pendingUserInputs);
      if (!signature) {
        lastFocusSignature = "";
        return false;
      }
      if (signature === lastFocusSignature) return false;
      lastFocusSignature = signature;
      return host.composerHasFocus();
    },
  };
}

function pendingRequestBlockState(state: ChatState): PendingRequestBlockState {
  return {
    approvals: state.requests.approvals,
    pendingUserInputs: state.requests.pendingUserInputs,
    userInputDrafts: state.requests.userInputDrafts,
    approvalDetails: state.ui.disclosures.approvalDetails,
  };
}

function pendingApproval(host: PendingRequestActionsHost, requestId: PendingRequestId): PendingApproval | null {
  return host.stateStore.getState().requests.approvals.find((approval) => approval.requestId === requestId) ?? null;
}

function pendingUserInput(host: PendingRequestActionsHost, requestId: PendingRequestId): PendingUserInput | null {
  return host.stateStore.getState().requests.pendingUserInputs.find((input) => input.requestId === requestId) ?? null;
}

function commitRequestAction(host: PendingRequestActionsHost): void {
  host.refreshLiveState();
}
