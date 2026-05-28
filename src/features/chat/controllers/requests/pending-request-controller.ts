import type { ReactNode } from "react";

import type { ApprovalAction, PendingApproval } from "../../approvals/model";
import type { ChatAction, ChatState, ChatStateStore } from "../../chat-state";
import type { ChatController } from "../../chat-controller";
import { pendingRequestFocusSignature } from "../../request-state";
import { pendingRequestMessageNode } from "../../ui/pending-request-message";
import { userInputDraftKey, userInputOtherDraftKey } from "../../user-input/drafts";
import { answersForPendingUserInput, type PendingUserInput } from "../../user-input/model";

export interface PendingRequestControllerHost {
  stateStore: ChatStateStore;
  controller: ChatController;
  composerHasFocus: () => boolean;
  refreshLiveState: () => void;
  render: () => void;
}

export class PendingRequestController {
  private lastFocusSignature = "";

  constructor(private readonly host: PendingRequestControllerHost) {}

  private get state(): ChatState {
    return this.host.stateStore.getState();
  }

  private dispatch(action: ChatAction): void {
    this.host.stateStore.dispatch(action);
  }

  renderNode(): ReactNode {
    return pendingRequestMessageNode(
      this.state.approvals,
      this.state.pendingUserInputs,
      {
        values: this.state.userInputDrafts,
        draftKey: userInputDraftKey,
        otherDraftKey: userInputOtherDraftKey,
      },
      this.state.openDetails,
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
          this.dispatch({ type: "ui/detail-open-set", key, open });
        },
        setUserInputDraft: (key, value) => {
          this.dispatch({ type: "request/user-input-draft-set", key, value });
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
    this.host.controller.resolveUserInput(input, answersForPendingUserInput(input, this.state.userInputDrafts));
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
    const signature = pendingRequestFocusSignature(this.state.approvals, this.state.pendingUserInputs);
    if (!signature) {
      this.lastFocusSignature = "";
      return false;
    }
    if (signature === this.lastFocusSignature) return false;
    this.lastFocusSignature = signature;
    return this.host.composerHasFocus();
  }
}
