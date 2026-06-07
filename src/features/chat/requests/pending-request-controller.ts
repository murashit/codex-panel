import type { ComponentChild as UiNode } from "preact";

import { setDetailOpenAction, setUserInputDraftAction } from "../chat-state-actions";
import { pendingRequestSnapshot } from "../chat-state-selectors";
import type { ChatStateStore } from "../chat-state";
import type { ApprovalAction, PendingApproval } from "../requests/approvals/model";
import type { ChatInboundController } from "../inbound/controller";
import { pendingRequestFocusSignature } from "../requests/view-model";
import { pendingRequestMessageNode } from "../ui/pending-request-message";
import { userInputDraftKey, userInputOtherDraftKey } from "../requests/user-input/drafts";
import { answersForPendingUserInput, type PendingUserInput } from "../requests/user-input/model";

export interface PendingRequestControllerHost {
  stateStore: ChatStateStore;
  controller: ChatInboundController;
  composerHasFocus: () => boolean;
  refreshLiveState: () => void;
  render: () => void;
}

export class PendingRequestController {
  private lastFocusSignature = "";

  constructor(private readonly host: PendingRequestControllerHost) {}

  renderNode(): UiNode {
    const state = pendingRequestSnapshot(this.host.stateStore.getState());
    return pendingRequestMessageNode(
      state.approvals,
      state.pendingUserInputs,
      {
        values: state.userInputDrafts,
        draftKey: userInputDraftKey,
        otherDraftKey: userInputOtherDraftKey,
      },
      state.openDetails,
      {
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
      },
      this.consumeAutoFocus(),
    );
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

  private consumeAutoFocus(): boolean {
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
