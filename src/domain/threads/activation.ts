import type { ReasoningEffort } from "../catalog/metadata";
import type { ActivePermissionProfile, ApprovalPolicy, ApprovalsReviewer, ServiceTier } from "../runtime/policy";
import type { Thread } from "./model";

export interface ThreadActivationSnapshot {
  thread: Thread;
  cwd: string;
  model: string | null;
  serviceTier: ServiceTier | null;
  approvalPolicy: ApprovalPolicy | null;
  approvalsReviewer: ApprovalsReviewer | null;
  activePermissionProfile: ActivePermissionProfile | null;
  reasoningEffort: ReasoningEffort | null;
}
