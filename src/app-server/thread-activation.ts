import type { ThreadResumeResponse } from "../generated/app-server/v2/ThreadResumeResponse";
import type { ThreadStartResponse } from "../generated/app-server/v2/ThreadStartResponse";
import type { Thread } from "../domain/threads/model";
import type { ActivePermissionProfile, ApprovalPolicy, ApprovalsReviewer, ServiceTier } from "./runtime-policy";
import { threadFromAppServerThread } from "./thread-model";

export interface ThreadActivationSnapshot {
  thread: Thread;
  cwd: string;
  model: string | null;
  serviceTier: ServiceTier | null;
  approvalPolicy: ApprovalPolicy | null;
  approvalsReviewer: ApprovalsReviewer | null;
  activePermissionProfile: ActivePermissionProfile | null;
  reasoningEffort: string | null;
}

export type AppServerThreadActivationResponse = ThreadStartResponse | ThreadResumeResponse;

export function threadActivationSnapshotFromAppServerResponse(response: AppServerThreadActivationResponse): ThreadActivationSnapshot {
  return {
    thread: threadFromAppServerThread(response.thread),
    cwd: response.cwd,
    model: response.model,
    reasoningEffort: response.reasoningEffort,
    serviceTier: response.serviceTier,
    approvalPolicy: response.approvalPolicy,
    approvalsReviewer: response.approvalsReviewer,
    activePermissionProfile: response.activePermissionProfile,
  };
}
