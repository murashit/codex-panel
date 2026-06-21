import type { ChatStateStore } from "../state/store";
import { pendingRequestFocusSignature } from "../../domain/pending-requests/signatures";
import {
  answersForPendingUserInput,
  type ApprovalAction,
  type McpElicitationAction,
  type PendingApproval,
  type PendingMcpElicitation,
  type PendingUserInput,
} from "../../../../domain/pending-requests/model";
import { approvalDetailsDisclosureId } from "../../domain/pending-requests/disclosure-ids";
import type { PendingRequestBlockActions, PendingRequestBlockState, PendingRequestId } from "./block";
import type { ChatState } from "../state/root-reducer";

interface PendingRequestResponder {
  resolveApproval: (requestId: PendingRequestId, action: ApprovalAction) => void;
  resolveUserInput: (requestId: PendingRequestId, answers: Record<string, string>) => void;
  cancelUserInput: (requestId: PendingRequestId) => void;
  resolveMcpElicitation: (requestId: PendingRequestId, action: McpElicitationAction) => void;
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
  resolveMcpElicitation(requestId: PendingRequestId, action: McpElicitationAction): void;
  consumeAutoFocus(): boolean;
}

export function createPendingRequestActions(host: PendingRequestActionsHost): PendingRequestActions {
  let lastFocusSignature = "";

  const resolveApproval = (requestId: PendingRequestId, approvalAction: ApprovalAction): void => {
    const approval = pendingApproval(host, requestId);
    if (!approval) return;
    host.responder.resolveApproval(requestId, approvalAction);
    commitRequestAction(host);
  };

  const resolveUserInput = (requestId: PendingRequestId): void => {
    const input = pendingUserInput(host, requestId);
    if (!input) return;
    host.responder.resolveUserInput(
      requestId,
      answersForPendingUserInput(input, pendingRequestBlockState(host.stateStore.getState()).userInputDrafts),
    );
    commitRequestAction(host);
  };

  const cancelUserInput = (requestId: PendingRequestId): void => {
    const input = pendingUserInput(host, requestId);
    if (!input) return;
    host.responder.cancelUserInput(requestId);
    commitRequestAction(host);
  };

  const resolveMcpElicitation = (requestId: PendingRequestId, action: McpElicitationAction): void => {
    const elicitation = pendingMcpElicitation(host, requestId);
    if (!elicitation) return;
    host.responder.resolveMcpElicitation(requestId, action);
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
    resolveMcpElicitation: (requestId, action) => {
      resolveMcpElicitation(requestId, action);
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
    setMcpElicitationDraft: (key, value) => {
      host.stateStore.dispatch({ type: "request/mcp-elicitation-draft-set", key, value });
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
    resolveMcpElicitation,

    consumeAutoFocus(): boolean {
      const state = host.stateStore.getState();
      const signature = pendingRequestFocusSignature(
        state.requests.approvals,
        state.requests.pendingUserInputs,
        state.requests.pendingMcpElicitations,
      );
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
    pendingMcpElicitations: state.requests.pendingMcpElicitations,
    userInputDrafts: state.requests.userInputDrafts,
    mcpElicitationDrafts: state.requests.mcpElicitationDrafts,
    approvalDetails: state.ui.disclosures.approvalDetails,
  };
}

function pendingApproval(host: PendingRequestActionsHost, requestId: PendingRequestId): PendingApproval | null {
  return host.stateStore.getState().requests.approvals.find((approval) => approval.requestId === requestId) ?? null;
}

function pendingUserInput(host: PendingRequestActionsHost, requestId: PendingRequestId): PendingUserInput | null {
  return host.stateStore.getState().requests.pendingUserInputs.find((input) => input.requestId === requestId) ?? null;
}

function pendingMcpElicitation(host: PendingRequestActionsHost, requestId: PendingRequestId): PendingMcpElicitation | null {
  return host.stateStore.getState().requests.pendingMcpElicitations.find((elicitation) => elicitation.requestId === requestId) ?? null;
}

function commitRequestAction(host: PendingRequestActionsHost): void {
  host.refreshLiveState();
}
