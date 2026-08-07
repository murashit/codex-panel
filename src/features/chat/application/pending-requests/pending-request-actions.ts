import { approvalDetailsDisclosureId } from "../../domain/pending-requests/disclosure-ids";
import { answersForPendingUserInput } from "../../domain/pending-requests/drafts";
import type { ApprovalAction, McpElicitationAction, PendingRequestId, PendingUserInput } from "../../domain/pending-requests/model";
import { pendingRequestFocusSignature } from "../../domain/pending-requests/signatures";
import type { ChatStateStore } from "../state/store";

interface PendingRequestResponder {
  resolveApproval: (requestId: PendingRequestId, action: ApprovalAction) => void;
  resolveUserInput: (requestId: PendingRequestId, answers: Record<string, string>) => void;
  skipUserInput: (requestId: PendingRequestId) => void;
  extendUserInputAutoResolution: (requestId: PendingRequestId) => void;
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
  readonly actions: {
    resolveApproval: (requestId: PendingRequestId, action: ApprovalAction) => void;
    resolveUserInput: (requestId: PendingRequestId) => void;
    skipUserInput: (requestId: PendingRequestId) => void;
    cancelUserInput: (requestId: PendingRequestId) => void;
    resolveMcpElicitation: (requestId: PendingRequestId, action: McpElicitationAction) => void;
    setApprovalDetailsExpanded: (requestId: PendingRequestId, expanded: boolean) => void;
    setUserInputDraft: (requestId: PendingRequestId, key: string, value: string) => void;
    setMcpElicitationDraft: (key: string, value: string) => void;
  };
  readonly consumeAutoFocus: () => boolean;
}

export function createPendingRequestActions(host: PendingRequestActionsHost): PendingRequestActions {
  let lastFocusSignature = "";

  const blockActions: PendingRequestActions["actions"] = {
    resolveApproval: (requestId, approvalAction) => {
      const approval = host.stateStore.getState().requests.approvals.find((item) => item.requestId === requestId) ?? null;
      if (!approval) return;
      host.responder.resolveApproval(requestId, approvalAction);
      commitRequestAction(host);
    },
    resolveUserInput: (requestId) => {
      const input = pendingUserInput(host, requestId);
      if (!input) return;
      host.responder.resolveUserInput(requestId, answersForPendingUserInput(input, host.stateStore.getState().requests.userInputDrafts));
      commitRequestAction(host);
    },
    skipUserInput: (requestId) => {
      const input = pendingUserInput(host, requestId);
      if (!input || input.params.isBlocking) return;
      host.responder.skipUserInput(requestId);
      commitRequestAction(host);
    },
    cancelUserInput: (requestId) => {
      const input = pendingUserInput(host, requestId);
      if (!input) return;
      host.responder.cancelUserInput(requestId);
      commitRequestAction(host);
    },
    resolveMcpElicitation: (requestId, action) => {
      const elicitation = host.stateStore.getState().requests.pendingMcpElicitations.find((item) => item.requestId === requestId) ?? null;
      if (!elicitation) return;
      host.responder.resolveMcpElicitation(requestId, action);
      commitRequestAction(host);
    },
    setApprovalDetailsExpanded: (requestId, expanded) => {
      host.stateStore.dispatch({
        type: "ui/disclosure-set",
        bucket: "approvalDetails",
        id: approvalDetailsDisclosureId(requestId),
        open: expanded,
      });
    },
    setUserInputDraft: (requestId, key, value) => {
      host.stateStore.dispatch({ type: "request/user-input-draft-set", key, value });
      const input = pendingUserInput(host, requestId);
      if (input && !input.params.isBlocking) host.responder.extendUserInputAutoResolution(requestId);
    },
    setMcpElicitationDraft: (key, value) => {
      host.stateStore.dispatch({ type: "request/mcp-elicitation-draft-set", key, value });
    },
  };

  return {
    actions: blockActions,

    consumeAutoFocus: (): boolean => {
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
