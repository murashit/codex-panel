import type { ComponentChild as UiNode } from "preact";

import type { ApprovalAction, PendingApproval } from "../../approvals/model";
import type { ChatController } from "../../chat-controller";
import { pendingRequestFocusSignature } from "../../request-state";
import { pendingRequestMessageNode } from "../../ui/pending-request-message";
import { userInputDraftKey, userInputOtherDraftKey } from "../../user-input/drafts";
import { answersForPendingUserInput, type PendingUserInput } from "../../user-input/model";
import type { PendingRequestStatePort } from "../state-ports";

export interface PendingRequestControllerHost {
  state: PendingRequestStatePort;
  controller: ChatController;
  composerHasFocus: () => boolean;
  refreshLiveState: () => void;
  render: () => void;
}

export class PendingRequestController {
  private lastFocusSignature = "";

  constructor(private readonly host: PendingRequestControllerHost) {}

  renderNode(): UiNode {
    const state = this.host.state.snapshot();
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
          this.host.state.setDetailOpen(key, open);
        },
        setUserInputDraft: (key, value) => {
          this.host.state.setUserInputDraft(key, value);
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
    this.host.controller.resolveUserInput(input, answersForPendingUserInput(input, this.host.state.snapshot().userInputDrafts));
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
    const state = this.host.state.snapshot();
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
