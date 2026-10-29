import type { PendingRequests } from "../../application/pending-requests/controller";
import type { ChatStateStore } from "../../application/state/store";
import { approvalDetailsDisclosureId } from "../../domain/pending-requests/disclosure-ids";
import { pendingRequestFocusSignature } from "../../domain/pending-requests/signatures";
import type { PendingRequestBlockActions } from "../../ui/thread-stream/context";

export interface PendingRequestActionsHost {
  stateStore: ChatStateStore;
  requests: PendingRequests;
  composerHasFocus: () => boolean;
  focusComposer: () => void;
}

export interface PendingRequestActions {
  readonly actions: PendingRequestBlockActions;
  readonly consumeAutoFocus: () => boolean;
}

export function createPendingRequestActions(host: PendingRequestActionsHost): PendingRequestActions {
  let lastFocusSignature = "";

  const blockActions: PendingRequestActions["actions"] = {
    resolveApproval: (requestId, approvalAction) => {
      if (host.requests.resolveApproval(requestId, approvalAction)) host.focusComposer();
    },
    resolveUserInput: (requestId) => {
      if (host.requests.resolveUserInput(requestId)) host.focusComposer();
    },
    skipUserInput: (requestId) => {
      if (host.requests.skipUserInput(requestId)) host.focusComposer();
    },
    cancelUserInput: (requestId) => {
      if (host.requests.cancelUserInput(requestId)) host.focusComposer();
    },
    resolveMcpElicitation: (requestId, action) => {
      if (host.requests.resolveMcpElicitation(requestId, action)) host.focusComposer();
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
      host.requests.setUserInputDraft(requestId, key, value);
    },
    setMcpElicitationDraft: (key, value) => {
      host.requests.setMcpElicitationDraft(key, value);
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
