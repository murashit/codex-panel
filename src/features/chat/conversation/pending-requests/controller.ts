import type { ChatStateStore } from "../../state/reducer";
import type { ApprovalAction, PendingApproval } from "../../protocol/server-requests/approval";
import type { ChatInboundController } from "../../protocol/inbound/controller";
import { pendingRequestFocusSignature } from "./signatures";
import { pendingRequestBlockSnapshot, type PendingRequestBlockSnapshot } from "./snapshot";
import type { PendingRequestBlockActions } from "../../ui/pending-request-block";
import { answersForPendingUserInput, type PendingUserInput } from "../../protocol/server-requests/user-input";

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
    resolveApproval: (approval, action) => {
      this.resolveApproval(approval, action);
    },
    resolveUserInput: (input) => {
      this.resolveUserInput(input);
    },
    cancelUserInput: (input) => {
      this.cancelUserInput(input);
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

  resolveApproval(approval: PendingApproval, action: ApprovalAction): void {
    this.host.controller.resolveApproval(approval, action);
    this.commitRequestAction();
  }

  resolveUserInput(input: PendingUserInput): void {
    this.host.controller.resolveUserInput(
      input,
      answersForPendingUserInput(input, pendingRequestBlockSnapshot(this.host.stateStore.getState()).userInputDrafts),
    );
    this.commitRequestAction();
  }

  cancelUserInput(input: PendingUserInput): void {
    this.host.controller.cancelUserInput(input);
    this.commitRequestAction();
  }

  private commitRequestAction(): void {
    this.host.refreshLiveState();
    this.host.render();
  }

  consumeAutoFocus(): boolean {
    const state = pendingRequestBlockSnapshot(this.host.stateStore.getState());
    const signature = pendingRequestFocusSignature(state.approvals, state.pendingUserInputs);
    if (!signature) {
      this.lastFocusSignature = "";
      return false;
    }
    if (signature === this.lastFocusSignature) return false;
    this.lastFocusSignature = signature;
    return this.host.composerHasFocus();
  }
}
