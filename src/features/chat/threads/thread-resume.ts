import { parseServiceTier } from "../../../app-server/service-tier";
import { upsertThread } from "../../../domain/threads/model";
import { panelThreadFromAppServerThread } from "../../../app-server/thread-model";
import type { ReasoningEffort } from "../../../domain/catalog/metadata";
import type { AskForApproval } from "../../../generated/app-server/v2/AskForApproval";
import type { PanelThread } from "../../../domain/threads/model";
import type { ThreadStartResponse } from "../../../generated/app-server/v2/ThreadStartResponse";
import type { ThreadResumeResponse } from "../../../generated/app-server/v2/ThreadResumeResponse";
import type { ChatRuntimeState } from "../runtime/state";
import type { DisplayItem } from "../display/types";
import type { ActiveThreadResumedAction } from "../chat-state-actions";

interface ThreadActivationResponse {
  thread: PanelThread;
  cwd: string;
  model: string | null;
  serviceTier: string | null;
  approvalPolicy: AskForApproval | null;
  approvalsReviewer: ChatRuntimeState["activeApprovalsReviewer"];
  activePermissionProfile: ChatRuntimeState["activePermissionProfile"];
  reasoningEffort: ReasoningEffort | null;
}

export interface ResumedThreadActionParams {
  response: ThreadActivationResponse;
  listedThreads?: readonly PanelThread[];
  displayItems?: readonly DisplayItem[];
}

export interface ResumedThreadFromAppServerParams {
  response: ThreadStartResponse | ThreadResumeResponse;
  listedThreads?: readonly PanelThread[];
  displayItems?: readonly DisplayItem[];
}

export interface ResumedThreadFromActiveRuntimeParams {
  thread: PanelThread;
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
  listedThreads?: readonly PanelThread[];
  displayItems?: readonly DisplayItem[];
}

export function resumedThreadActionFromAppServerResponse(params: ResumedThreadFromAppServerParams): ActiveThreadResumedAction {
  return resumedThreadAction({
    response: threadActivationResponseFromAppServerResponse(params.response),
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
    serviceTier: parseServiceTier(response.serviceTier),
    approvalPolicy: response.approvalPolicy,
    approvalsReviewer: response.approvalsReviewer,
    activePermissionProfile: response.activePermissionProfile,
    ...(params.displayItems ? { displayItems: params.displayItems } : {}),
    ...(params.listedThreads ? { listedThreads: upsertThread(params.listedThreads, response.thread) } : {}),
  };
}

function threadActivationResponseFromAppServerResponse(response: ThreadStartResponse | ThreadResumeResponse): ThreadActivationResponse {
  return {
    thread: panelThreadFromAppServerThread(response.thread),
    cwd: response.cwd,
    model: response.model,
    reasoningEffort: response.reasoningEffort,
    serviceTier: response.serviceTier,
    approvalPolicy: response.approvalPolicy,
    approvalsReviewer: response.approvalsReviewer,
    activePermissionProfile: response.activePermissionProfile,
  };
}
