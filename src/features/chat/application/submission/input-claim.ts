import type { ComposerInputSnapshot } from "../composer/input-snapshot";
import { type ChatState, panelThreadId } from "../state/model";
import { capturePanelTargetLease, type PanelTargetLease, panelTargetLeaseIsCurrent } from "../state/panel-target";

export interface ComposerSubmissionAdoption {
  readonly isCurrent: () => boolean;
  readonly adoptPanelTarget: (targetThreadId: string | null, replacementDraft?: string) => void;
}

export interface ComposerSubmissionClaim extends ComposerSubmissionAdoption {
  readonly text: string;
  readonly inputSnapshot: ComposerInputSnapshot;
  readonly settle: (outcome: "accepted" | "failed", replacementDraft?: string) => void;
}

type TargetAdoption = { targetThreadId: string | null; replacementDraft?: string };

export class SubmissionInput implements ComposerSubmissionClaim {
  private panelTarget: PanelTargetLease;
  private settled = false;
  private targetAdoption: TargetAdoption | null = null;

  constructor(
    readonly text: string,
    readonly inputSnapshot: ComposerInputSnapshot,
    private readonly state: () => ChatState,
    private readonly finish: (outcome: "accepted" | "failed" | "discarded", replacementDraft?: string) => void,
  ) {
    this.panelTarget = capturePanelTargetLease(state());
  }

  readonly isCurrent = (): boolean => !this.settled && panelTargetLeaseIsCurrent(this.state(), this.panelTarget);

  readonly adoptPanelTarget = (targetThreadId: string | null, replacementDraft?: string): void => {
    if (this.settled) return;
    this.targetAdoption = replacementDraft === undefined ? { targetThreadId } : { targetThreadId, replacementDraft };
  };

  reconcilePanelTarget(): TargetAdoption | null {
    const state = this.state();
    if (this.settled || panelTargetLeaseIsCurrent(state, this.panelTarget)) return null;
    const adoption = this.targetAdoption;
    if (adoption && adoption.targetThreadId === panelThreadId(state)) {
      this.panelTarget = capturePanelTargetLease(state);
      this.targetAdoption = null;
      return adoption;
    }
    this.settle("failed");
    return null;
  }

  readonly settle = (outcome: "accepted" | "failed", replacementDraft?: string): void => {
    if (this.settled) return;
    const current = this.isCurrent();
    this.settled = true;
    this.finish(current ? outcome : "discarded", replacementDraft);
  };
}
