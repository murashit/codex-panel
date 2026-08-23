import type { ReasoningEffort } from "../catalog/metadata";
import type { RuntimePermissionKnownState, RuntimePermissionState } from "../runtime/permissions";
import type { ApprovalsReviewer, ServiceTier } from "../runtime/policy";
import type { Thread } from "./model";

export interface ThreadActivationSnapshot extends RuntimePermissionState, RuntimePermissionKnownState {
  thread: Thread;
  /**
   * Whether the activated app-server thread accepts direct turn input.
   * `null` means the capability is unavailable, so panel mode policy decides.
   */
  canAcceptDirectInput: boolean | null;
  model: string | null;
  serviceTier: ServiceTier | null;
  approvalsReviewer: ApprovalsReviewer | null;
  reasoningEffort: ReasoningEffort | null;
}
