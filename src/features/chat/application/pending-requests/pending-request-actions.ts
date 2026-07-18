import {
  type ApprovalAction,
  answersForPendingUserInput,
  type McpElicitationAction,
  type PendingRequestId,
  type PendingUserInput,
} from "../../../../domain/pending-requests/model";
import { approvalDetailsDisclosureId } from "../../domain/pending-requests/disclosure-ids";
import { pendingRequestFocusSignature } from "../../domain/pending-requests/signatures";
import type { ChatStateStore } from "../state/store";
import { type PendingRequestBlockActions, pendingRequestBlockStateFromChatState } from "./block";

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
  focusComposer: () => void;
}

export interface PendingRequestActions {
  actions(): PendingRequestBlockActions;
  consumeAutoFocus(): boolean;
}

export function createPendingRequestActions(host: PendingRequestActionsHost): PendingRequestActions {
  let lastFocusSignature = "";

  const resolveApproval = (requestId: PendingRequestId, approvalAction: ApprovalAction): void => {
    const approval = host.stateStore.getState().requests.approvals.find((item) => item.requestId === requestId) ?? null;
    if (!approval) return;
    host.responder.resolveApproval(requestId, approvalAction);
    commitRequestAction(host);
  };

  const resolveUserInput = (requestId: PendingRequestId): void => {
    const input = pendingUserInput(host, requestId);
    if (!input) return;
    host.responder.resolveUserInput(
      requestId,
      answersForPendingUserInput(input, pendingRequestBlockStateFromChatState(host.stateStore.getState()).userInputDrafts),
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
    const elicitation = host.stateStore.getState().requests.pendingMcpElicitations.find((item) => item.requestId === requestId) ?? null;
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
    actions(): PendingRequestBlockActions {
      return blockActions;
    },

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

function pendingUserInput(host: PendingRequestActionsHost, requestId: PendingRequestId): PendingUserInput | null {
  return host.stateStore.getState().requests.pendingUserInputs.find((input) => input.requestId === requestId) ?? null;
}

function commitRequestAction(host: PendingRequestActionsHost): void {
  host.focusComposer();
}
