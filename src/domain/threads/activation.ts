import type { ReasoningEffort } from "../catalog/metadata";
import type { ApprovalsReviewer, ServiceTier } from "../runtime/policy";
import type { Thread } from "./model";

export interface ThreadActivationSnapshot {
  thread: Thread;
  cwd: string;
  model: string | null;
  serviceTier: ServiceTier | null;
  approvalsReviewer: ApprovalsReviewer | null;
  reasoningEffort: ReasoningEffort | null;
}
