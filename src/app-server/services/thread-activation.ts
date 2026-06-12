import type { Thread } from "../../domain/threads/model";
import { normalizeReasoningEffort, type ReasoningEffort } from "../../domain/catalog/metadata";
import type { ActivePermissionProfile, ApprovalPolicy, ApprovalsReviewer, ServiceTier } from "../../domain/runtime/policy";
import { parseServiceTier } from "../../domain/runtime/policy";
import { threadFromThreadRecord, type ThreadRecord } from "../protocol/thread";

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

export interface ThreadActivationResponse {
  thread: ThreadRecord;
  cwd: string;
  model: string | null;
  serviceTier: ServiceTier | null;
  approvalPolicy: ApprovalPolicy | null;
  approvalsReviewer: ApprovalsReviewer | null;
  activePermissionProfile: ActivePermissionProfile | null;
  reasoningEffort: string | null;
}

export function threadActivationSnapshotFromAppServerResponse(response: ThreadActivationResponse): ThreadActivationSnapshot {
  return {
    thread: threadFromThreadRecord(response.thread),
    cwd: response.cwd,
    model: response.model,
    reasoningEffort: normalizeReasoningEffort(response.reasoningEffort),
    serviceTier: parseServiceTier(response.serviceTier),
    approvalPolicy: response.approvalPolicy,
    approvalsReviewer: response.approvalsReviewer,
    activePermissionProfile: response.activePermissionProfile,
  };
}
