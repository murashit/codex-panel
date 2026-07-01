import type { ReasoningEffort } from "../catalog/metadata";
import type { RuntimePermissionState } from "../runtime/permissions";
import type { ApprovalsReviewer, ServiceTier } from "../runtime/policy";
import type { Thread } from "./model";

export interface ThreadActivationSnapshot extends RuntimePermissionState {
  thread: Thread;
  cwd: string;
  model: string | null;
  serviceTier: ServiceTier | null;
  approvalsReviewer: ApprovalsReviewer | null;
  reasoningEffort: ReasoningEffort | null;
}
