import type { ComposerInputSnapshot } from "../composer/input-snapshot";
import { type ChatState, panelThreadId } from "../state/model";
import { capturePanelTargetLease, type PanelTargetLease, panelTargetLeaseIsCurrent } from "../state/panel-target";

export interface ComposerSubmissionAdoption {
  readonly isCurrent: () => boolean;
  readonly markAdopted: () => void;
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
  private phase: "preflight" | "adopted" | "settled" = "preflight";
  private targetAdoption: TargetAdoption | null = null;

  constructor(
    readonly text: string,
    readonly inputSnapshot: ComposerInputSnapshot,
    private readonly state: () => ChatState,
    private readonly finish: (outcome: "accepted" | "failed" | "discarded", replacementDraft?: string) => void,
  ) {
    this.panelTarget = capturePanelTargetLease(state());
  }

  readonly isCurrent = (): boolean => this.phase !== "settled" && panelTargetLeaseIsCurrent(this.state(), this.panelTarget);

  readonly markAdopted = (): void => {
    if (this.phase !== "settled") this.phase = "adopted";
  };

  readonly adoptPanelTarget = (targetThreadId: string | null, replacementDraft?: string): void => {
    if (this.phase === "settled") return;
    this.phase = "adopted";
    this.targetAdoption = replacementDraft === undefined ? { targetThreadId } : { targetThreadId, replacementDraft };
  };

  reconcilePanelTarget(): TargetAdoption | null {
    const state = this.state();
    if (this.phase === "settled" || panelTargetLeaseIsCurrent(state, this.panelTarget)) return null;
    const adoption = this.targetAdoption;
    if (adoption && adoption.targetThreadId === panelThreadId(state)) {
      this.panelTarget = capturePanelTargetLease(state);
      this.targetAdoption = null;
      return adoption;
    }
    this.settle("failed");
    return null;
  }

  settleForSnapshot(): void {
    this.settle(this.phase === "adopted" ? "accepted" : "failed");
  }

  readonly settle = (outcome: "accepted" | "failed", replacementDraft?: string): void => {
    if (this.phase === "settled") return;
    const current = this.isCurrent();
    this.phase = "settled";
    this.finish(current ? outcome : "discarded", replacementDraft);
  };
}
