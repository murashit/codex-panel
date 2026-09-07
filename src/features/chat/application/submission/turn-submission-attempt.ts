import { activeThreadState } from "../state/model";
import { capturePanelTargetLease, type PanelTargetLease, panelTargetLeaseIsCurrent } from "../state/panel-target";
import { pendingSubmissionMatches } from "../state/pending-submission";
import type { ChatStateStore } from "../state/store";
import { pendingTurnStart } from "../turns/turn-state";
import type { ComposerSubmissionAdoption, ComposerSubmissionClaim } from "./input-claim";

export interface TurnSubmissionAttemptInput {
  pendingSubmissionId?: string;
  submissionClaim?: ComposerSubmissionClaim;
}

export class TurnSubmissionAttempt {
  private panelTarget: PanelTargetLease;
  private optimisticItemId: string | null = null;
  private expectedThreadId: string | null = null;

  constructor(
    private readonly stateStore: ChatStateStore,
    private readonly input: TurnSubmissionAttemptInput,
  ) {
    this.panelTarget = capturePanelTargetLease(stateStore.getState());
  }

  get pendingSubmissionId(): string | undefined {
    return this.input.pendingSubmissionId;
  }

  get adoptPanelTarget(): ComposerSubmissionAdoption["adoptPanelTarget"] | undefined {
    return this.input.submissionClaim?.adoptPanelTarget;
  }

  get optimisticId(): string | null {
    return this.optimisticItemId;
  }

  refreshPanelTarget(): void {
    this.panelTarget = capturePanelTargetLease(this.stateStore.getState());
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

  recordOptimistic(threadId: string, optimisticItemId: string): void {
    this.expectedThreadId = threadId;
    this.optimisticItemId = optimisticItemId;
  }

  failureStillApplies(): boolean {
    if (!this.optimisticItemId) return this.isCurrent();
    const state = this.stateStore.getState();
    return (
      activeThreadState(state)?.id === this.expectedThreadId && pendingTurnStart(state.activeTurn)?.anchorItemId === this.optimisticItemId
    );
  }

  settle(accepted: boolean): void {
    this.input.submissionClaim?.settle(accepted ? "accepted" : "failed");
  }
}
