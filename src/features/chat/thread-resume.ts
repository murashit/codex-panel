import { parseServiceTier } from "../../app-server/service-tier";
import { upsertThread } from "../../domain/threads/model";
import type { Thread } from "../../generated/app-server/v2/Thread";
import type { ThreadResumeResponse } from "../../generated/app-server/v2/ThreadResumeResponse";
import type { ChatAction } from "./chat-state";
import type { DisplayItem } from "./display/types";

export interface ResumedThreadActionParams {
  response: ThreadResumeResponse;
  listedThreads: readonly Thread[];
  displayItems?: readonly DisplayItem[];
}

export function resumedThreadAction(params: ResumedThreadActionParams): Extract<ChatAction, { type: "thread/resumed" }> {
  const { response } = params;
  return {
    type: "thread/resumed",
    thread: response.thread,
    cwd: response.cwd,
    model: response.model,
    reasoningEffort: response.reasoningEffort,
    serviceTier: parseServiceTier(response.serviceTier),
    approvalPolicy: response.approvalPolicy,
    approvalsReviewer: response.approvalsReviewer,
    activePermissionProfile: response.activePermissionProfile,
    ...(params.displayItems ? { displayItems: params.displayItems } : {}),
    listedThreads: upsertThread(params.listedThreads, response.thread),
  };
}
