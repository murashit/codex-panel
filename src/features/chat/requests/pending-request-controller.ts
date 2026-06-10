import { setDetailOpenAction, setUserInputDraftAction } from "../chat-state-actions";
import { pendingRequestSnapshot, type PendingRequestSnapshot } from "../chat-state-selectors";
import type { ChatStateStore } from "../chat-state";
import type { ApprovalAction, PendingApproval } from "../requests/approval";
import type { ChatInboundController } from "../inbound/controller";
import { pendingRequestFocusSignature } from "../requests/view-model";
import type { PendingRequestMessageActions } from "../ui/pending-request-message";
import { answersForPendingUserInput, type PendingUserInput } from "../requests/user-input";

export interface PendingRequestControllerHost {
  stateStore: ChatStateStore;
  controller: ChatInboundController;
  composerHasFocus: () => boolean;
  refreshLiveState: () => void;
  render: () => void;
}

export class PendingRequestController {
  private lastFocusSignature = "";
  private readonly messageActions: PendingRequestMessageActions = {
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
      this.host.stateStore.dispatch(setDetailOpenAction(key, open));
    },
    setUserInputDraft: (key, value) => {
      this.host.stateStore.dispatch(setUserInputDraftAction(key, value));
    },
  };

  constructor(private readonly host: PendingRequestControllerHost) {}

  snapshot(): PendingRequestSnapshot {
    return pendingRequestSnapshot(this.host.stateStore.getState());
  }

  actions(): PendingRequestMessageActions {
    return this.messageActions;
  }

  resolveApproval(approval: PendingApproval, action: ApprovalAction): void {
    this.host.controller.resolveApproval(approval, action);
    this.commitRequestAction();
  }

  resolveUserInput(input: PendingUserInput): void {
    this.host.controller.resolveUserInput(
      input,
      answersForPendingUserInput(input, pendingRequestSnapshot(this.host.stateStore.getState()).userInputDrafts),
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
    const state = pendingRequestSnapshot(this.host.stateStore.getState());
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
