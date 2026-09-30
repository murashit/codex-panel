import { activeThreadState } from "../state/model";
import { capturePanelTargetLease, type PanelTargetLease, panelTargetLeaseIsCurrent } from "../state/panel-target";
import { pendingSubmissionMatches } from "../state/pending-submission";
import type { ChatStateStore } from "../state/store";
import type { ComposerSubmissionClaim } from "./input-claim";

export interface TurnSubmissionAttemptInput {
  pendingSubmissionId?: string;
  submissionClaim?: ComposerSubmissionClaim;
}

export class TurnSubmissionAttempt {
  private readonly panelTarget: PanelTargetLease;

  constructor(
    private readonly stateStore: ChatStateStore,
    private readonly input: TurnSubmissionAttemptInput,
  ) {
    this.panelTarget = capturePanelTargetLease(stateStore.getState());
  }

  get pendingSubmissionId(): string | undefined {
    return this.input.pendingSubmissionId;
  }

  isPendingCurrent(): boolean {
    if (!this.input.pendingSubmissionId) return true;
    const state = this.stateStore.getState();
    return pendingSubmissionMatches(
      { pendingSubmission: state.pendingSubmission, activeThreadId: activeThreadState(state)?.id ?? null },
      this.input.pendingSubmissionId,
    );
  }

  isCurrent(): boolean {
    return this.isPendingCurrent() && panelTargetLeaseIsCurrent(this.stateStore.getState(), this.panelTarget);
  }

  commitPending(): boolean {
    if (!this.input.pendingSubmissionId) return true;
    if (!this.isPendingCurrent()) return false;
    this.stateStore.dispatch({ type: "web-submission/committed", submissionId: this.input.pendingSubmissionId });
    return this.isPendingCurrent() && this.stateStore.getState().pendingSubmission?.phase === "committed";
  }

  failPending(): boolean {
    if (!this.input.pendingSubmissionId || !this.isPendingCurrent()) return false;
    this.stateStore.dispatch({ type: "web-submission/failed", submissionId: this.input.pendingSubmissionId });
    return true;
  }

  markAdopted(): void {
    this.input.submissionClaim?.markAdopted();
  }

  settle(accepted: boolean): void {
    this.input.submissionClaim?.settle(accepted ? "accepted" : "failed");
  }
}
