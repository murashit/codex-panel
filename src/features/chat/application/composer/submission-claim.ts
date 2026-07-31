import type { ComposerInputSnapshot } from "./input-snapshot";

export interface ComposerSubmissionAdoption {
  readonly isCurrent: () => boolean;
  readonly markAdopted: () => void;
  readonly adoptPanelTarget: PanelTargetAdopter;
}

type PanelTargetAdopter = (targetThreadId: string | null, replacementDraft?: string) => void;

export interface ComposerSubmissionClaim extends ComposerSubmissionAdoption {
  readonly text: string;
  readonly inputSnapshot: ComposerInputSnapshot;
  readonly settle: (outcome: "accepted" | "failed", replacementDraft?: string) => void;
}
