import { parseServiceTier } from "../../../runtime/service-tier";
import { upsertThread } from "../../../domain/threads/model";
import type { ReasoningEffort } from "../../../runtime/models";
import type { ActivePermissionProfile } from "../../../generated/app-server/v2/ActivePermissionProfile";
import type { ApprovalsReviewer } from "../../../runtime/approvals";
import type { AskForApproval } from "../../../generated/app-server/v2/AskForApproval";
import type { PanelThread } from "../../../domain/threads/model";
import type { ActiveThreadResumedAction } from "../chat-state";
import type { DisplayItem } from "../display/types";

export interface ThreadActivationResponse {
  thread: PanelThread;
  cwd: string;
  model: string;
  serviceTier: string | null;
  approvalPolicy: AskForApproval | null;
  approvalsReviewer: ApprovalsReviewer | null;
  activePermissionProfile: ActivePermissionProfile | null;
  reasoningEffort: ReasoningEffort | null;
}

export interface ResumedThreadActionParams {
  response: ThreadActivationResponse;
  listedThreads?: readonly PanelThread[];
  displayItems?: readonly DisplayItem[];
}

export function resumedThreadAction(params: ResumedThreadActionParams): ActiveThreadResumedAction {
  const { response } = params;
  return {
    type: "active-thread/resumed",
    thread: response.thread,
    cwd: response.cwd,
    model: response.model,
    reasoningEffort: response.reasoningEffort,
    serviceTier: parseServiceTier(response.serviceTier),
    approvalPolicy: response.approvalPolicy,
    approvalsReviewer: response.approvalsReviewer,
    activePermissionProfile: response.activePermissionProfile,
    ...(params.displayItems ? { displayItems: params.displayItems } : {}),
    ...(params.listedThreads ? { listedThreads: upsertThread(params.listedThreads, response.thread) } : {}),
  };
}
