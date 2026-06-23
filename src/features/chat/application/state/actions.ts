import type { ServerInitialization } from "../../../../domain/server/initialization";
import type { ThreadActivationSnapshot } from "../../../../domain/threads/activation";
import { upsertThread, type Thread } from "../../../../domain/threads/model";
import { parseServiceTier, type ServiceTier } from "../../../../domain/runtime/policy";
import { normalizeReasoningEffort, type ReasoningEffort } from "../../../../domain/catalog/metadata";
import type { ActiveThreadRuntimeState } from "../../domain/runtime/state";
import type { CollaborationModeSelection } from "../../domain/runtime/intent";
import type { MessageStreamItem } from "../../domain/message-stream/items";
import type { PendingTurnStart } from "../conversation/turn-state";

interface ResumedThreadActionParams {
  response: ThreadActivationSnapshot;
  listedThreads?: readonly Thread[];
  items?: readonly MessageStreamItem[];
  preserveRequestedRuntimeSettings?: boolean;
  serviceTierKnown?: boolean;
}

interface ResumedThreadFromActiveRuntimeParams {
  thread: Thread;
  cwd: string;
  runtime: Pick<ActiveThreadRuntimeState, "model" | "reasoningEffort" | "serviceTier" | "serviceTierKnown" | "approvalsReviewer">;
  listedThreads?: readonly Thread[];
  items?: readonly MessageStreamItem[];
}

export interface ActiveThreadResumedAction {
  type: "active-thread/resumed";
  thread: Thread;
  cwd: string;
  model: string | null;
  reasoningEffort: ReasoningEffort | null;
  serviceTier: ServiceTier | null;
  serviceTierKnown?: boolean;
  approvalsReviewer: ActiveThreadRuntimeState["approvalsReviewer"];
  items?: readonly MessageStreamItem[];
  status?: string;
  listedThreads?: readonly Thread[];
  preserveRequestedRuntimeSettings?: boolean;
}

export interface ActiveThreadSettingsAppliedAction {
  type: "active-thread/settings-applied";
  cwd: string;
  model: string | null;
  reasoningEffort: ReasoningEffort | null;
  collaborationMode: CollaborationModeSelection;
  serviceTier: ServiceTier | null;
  approvalsReviewer: ActiveThreadRuntimeState["approvalsReviewer"];
}

export interface ActiveThreadSettingsAppliedActionSettings {
  cwd: string;
  model: string | null;
  effort: string | null;
  collaborationMode: { mode: CollaborationModeSelection };
  serviceTier: string | null;
  approvalsReviewer: ActiveThreadRuntimeState["approvalsReviewer"];
}

export interface ConnectionInitializedAction {
  type: "connection/initialized";
  initializeResponse: ServerInitialization;
}

export interface ClearDisconnectedConnectionStateAction {
  type: "connection/scoped-cleared";
}

export interface ClearLocalTurnAction {
  type: "turn/scoped-cleared";
}

export interface ClearActiveThreadAction {
  type: "active-thread/cleared";
}

export interface ThreadListAppliedAction {
  type: "thread-list/applied";
  threads: readonly Thread[];
  threadsLoaded?: boolean;
}

export interface DisclosureSetAction {
  type: "ui/disclosure-set";
  bucket: "details" | "activityGroups" | "textDetails" | "userMessageExpanded" | "goalObjectiveExpanded" | "approvalDetails";
  id: string;
  open: boolean;
}

export interface TurnOptimisticStartedAction {
  type: "turn/optimistic-started";
  item: MessageStreamItem;
  pendingTurnStart: PendingTurnStart;
}

export interface TurnStartAcknowledgedAction {
  type: "turn/start-acknowledged";
  turnId: string;
  items: readonly MessageStreamItem[];
}

export interface TurnStartFailedAction {
  type: "turn/start-failed";
  items: readonly MessageStreamItem[];
}

export function resumedThreadActionFromActiveRuntime(params: ResumedThreadFromActiveRuntimeParams): ActiveThreadResumedAction {
  return resumedThreadAction({
    response: {
      thread: params.thread,
      cwd: params.cwd,
      model: params.runtime.model,
      reasoningEffort: params.runtime.reasoningEffort,
      serviceTier: params.runtime.serviceTier,
      approvalsReviewer: params.runtime.approvalsReviewer,
    },
    serviceTierKnown: params.runtime.serviceTierKnown,
    ...(params.listedThreads ? { listedThreads: params.listedThreads } : {}),
    ...(params.items ? { items: params.items } : {}),
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
    serviceTierKnown: params.serviceTierKnown ?? true,
    approvalsReviewer: response.approvalsReviewer,
    ...(params.items ? { items: params.items } : {}),
    ...(params.listedThreads ? { listedThreads: upsertThread(params.listedThreads, response.thread) } : {}),
    ...(params.preserveRequestedRuntimeSettings ? { preserveRequestedRuntimeSettings: true } : {}),
  };
}

export function activeThreadSettingsAppliedAction(settings: ActiveThreadSettingsAppliedActionSettings): ActiveThreadSettingsAppliedAction {
  return {
    type: "active-thread/settings-applied",
    cwd: settings.cwd,
    model: settings.model,
    reasoningEffort: normalizeReasoningEffort(settings.effort),
    collaborationMode: settings.collaborationMode.mode,
    serviceTier: parseServiceTier(settings.serviceTier),
    approvalsReviewer: settings.approvalsReviewer,
  };
}
