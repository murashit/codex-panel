import type { ReasoningEffort } from "../../../../domain/runtime/catalog";
import type { RuntimeApprovalPolicy, RuntimeSandboxPolicy } from "../../../../domain/runtime/permissions";
import type { ApprovalsReviewer, ServiceTier } from "../../../../domain/runtime/settings";
import type { ChatRuntimeState } from "../../domain/runtime/state";
import type { ForkDisplaySnapshot } from "./fork-display-snapshot";

export interface ForkDraft {
  readonly sourceThreadId: string;
  readonly boundary: { readonly kind: "through-turn" | "before-turn"; readonly turnId: string };
  readonly replacement?: ForkReplacement;
  readonly initialPrompt?: string;
}

export interface ForkReplacement {
  readonly sourceThreadId: string;
  readonly sourceLatestTurnId: string;
  readonly saveMarkdown: boolean;
}

export interface ForkDraftPreparation {
  readonly runtime: ChatRuntimeState;
  readonly draft: ForkDraft;
  readonly display: ForkDisplaySnapshot;
}

type ThreadForkPosition =
  | { readonly kind: "through-turn"; readonly turnId: string }
  | { readonly kind: "before-turn"; readonly turnId: string };

export interface ThreadForkOptions {
  readonly position?: ThreadForkPosition;
  readonly deferGoalContinuation?: boolean;
  readonly runtime?: ThreadForkRuntimeOverrides;
}

interface ThreadForkRuntimeOverrides {
  readonly model?: string;
  readonly reasoningEffort?: ReasoningEffort | null;
  readonly serviceTier?: ServiceTier | null;
  readonly approvalPolicy?: RuntimeApprovalPolicy;
  readonly approvalsReviewer?: ApprovalsReviewer;
  readonly permissions?: string;
  readonly sandboxPolicy?: RuntimeSandboxPolicy;
}

export function forkDraftRuntime({ active, pending }: ChatRuntimeState): ChatRuntimeState {
  // The fork request carries inherited settings except collaboration mode.
  // Reserve that mode for the first turn; leave explicit user changes intact.
  return {
    active,
    pending: {
      ...pending,
      collaborationMode:
        pending.collaborationMode.kind === "unchanged" && active.collaborationMode
          ? { kind: "set", value: active.collaborationMode }
          : pending.collaborationMode,
    },
  };
}
