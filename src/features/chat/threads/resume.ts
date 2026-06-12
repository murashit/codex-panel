import { upsertThread } from "../../../domain/threads/model";
import type { Thread } from "../../../domain/threads/model";
import {
  threadActivationSnapshotFromAppServerResponse,
  type ThreadActivationSnapshot,
} from "../../../app-server/services/thread-activation";
import type { ChatRuntimeState } from "../runtime/state";
import type { DisplayItem } from "../display/types";
import type { ActiveThreadResumedAction } from "../state/actions";

export interface ResumedThreadActionParams {
  response: ThreadActivationSnapshot;
  listedThreads?: readonly Thread[];
  displayItems?: readonly DisplayItem[];
}

export interface ResumedThreadFromAppServerParams {
  response: Parameters<typeof threadActivationSnapshotFromAppServerResponse>[0];
  listedThreads?: readonly Thread[];
  displayItems?: readonly DisplayItem[];
}

export interface ResumedThreadFromActiveRuntimeParams {
  thread: Thread;
  cwd: string;
  runtime: Pick<
    ChatRuntimeState,
    | "activeModel"
    | "activeReasoningEffort"
    | "activeServiceTier"
    | "activeApprovalPolicy"
    | "activeApprovalsReviewer"
    | "activePermissionProfile"
  >;
  listedThreads?: readonly Thread[];
  displayItems?: readonly DisplayItem[];
}

export function resumedThreadActionFromAppServerResponse(params: ResumedThreadFromAppServerParams): ActiveThreadResumedAction {
  return resumedThreadAction({
    response: threadActivationSnapshotFromAppServerResponse(params.response),
    ...(params.listedThreads ? { listedThreads: params.listedThreads } : {}),
    ...(params.displayItems ? { displayItems: params.displayItems } : {}),
  });
}

export function resumedThreadActionFromActiveRuntime(params: ResumedThreadFromActiveRuntimeParams): ActiveThreadResumedAction {
  return resumedThreadAction({
    response: {
      thread: params.thread,
      cwd: params.cwd,
      model: params.runtime.activeModel,
      reasoningEffort: params.runtime.activeReasoningEffort,
      serviceTier: params.runtime.activeServiceTier,
      approvalPolicy: params.runtime.activeApprovalPolicy,
      approvalsReviewer: params.runtime.activeApprovalsReviewer,
      activePermissionProfile: params.runtime.activePermissionProfile,
    },
    ...(params.listedThreads ? { listedThreads: params.listedThreads } : {}),
    ...(params.displayItems ? { displayItems: params.displayItems } : {}),
  });
}

export function resumedThreadAction(params: ResumedThreadActionParams): ActiveThreadResumedAction {
  const { response } = params;
  return {
    type: "active-thread/resumed",
    thread: response.thread,
    cwd: response.cwd,
    model: response.model,
    reasoningEffort: response.reasoningEffort,
    serviceTier: response.serviceTier,
    approvalPolicy: response.approvalPolicy,
    approvalsReviewer: response.approvalsReviewer,
    activePermissionProfile: response.activePermissionProfile,
    ...(params.displayItems ? { displayItems: params.displayItems } : {}),
    ...(params.listedThreads ? { listedThreads: upsertThread(params.listedThreads, response.thread) } : {}),
  };
}
