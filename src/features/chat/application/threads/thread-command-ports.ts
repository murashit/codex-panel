import type { ReasoningEffort } from "../../../../domain/catalog/metadata";
import type { RuntimeApprovalPolicy, RuntimeSandboxPolicy } from "../../../../domain/runtime/permissions";
import type { ApprovalsReviewer, ServiceTier } from "../../../../domain/runtime/policy";
import type { Thread } from "../../../../domain/threads/model";
import type { EffectOutcome } from "../effect-outcome";

type ThreadForkPosition =
  | { readonly kind: "through-turn"; readonly turnId: string }
  | { readonly kind: "before-turn"; readonly turnId: string };

interface ThreadForkOptions {
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

export interface ThreadCommandPort {
  ensureConnected(): Promise<boolean>;
  compactThread(threadId: string): Promise<EffectOutcome<void>>;
  forkThread(threadId: string, options?: ThreadForkOptions): Promise<EffectOutcome<Thread>>;
}
