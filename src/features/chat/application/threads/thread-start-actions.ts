import { runtimeConfigOrDefault } from "../../../../domain/runtime/config";
import type { Thread } from "../../../../domain/threads/model";
import type { RuntimeSnapshot } from "../../domain/runtime/snapshot";
import { permissionProfileRequestForThreadStart, serviceTierRequestForThreadStart } from "../../domain/runtime/thread-settings-patch";
import { effectCompleted, effectCompletedInCurrentContext } from "../effect-outcome";
import { resumedThreadAction } from "../state/actions";
import { capturePanelTargetLease, panelTargetLeaseIsCurrent } from "../state/panel-target";
import { pendingSubmissionMatches } from "../state/pending-submission";
import { activeThreadId, type ChatState } from "../state/root-reducer";
import type { ChatStateStore } from "../state/store";
import type { ThreadStartPort } from "./thread-start-port";

export type ThreadStartOutcome =
  | { readonly kind: "not-started" }
  | { readonly kind: "created-activated"; readonly threadId: string }
  | { readonly kind: "created-not-activated"; readonly threadId: string };

export interface ThreadStartActionsHost {
  stateStore: ChatStateStore;
  threadStartPort: ThreadStartPort;
  runtimeSnapshotForState: (state: ChatState) => RuntimeSnapshot;
  recordStartedThread: (thread: Thread) => void;
  syncThreadGoal: (threadId: string) => void;
}

export interface ThreadStartActions {
  startThread: (preview?: string, options?: { syncGoal?: boolean; preservePendingSubmissionId?: string }) => Promise<ThreadStartOutcome>;
}

export function createThreadStartActions(host: ThreadStartActionsHost): ThreadStartActions {
  return {
    startThread: (preview, options) => startThread(host, preview, options),
  };
}

async function startThread(
  host: ThreadStartActionsHost,
  preview?: string,
  options: { syncGoal?: boolean; preservePendingSubmissionId?: string } = {},
): Promise<ThreadStartOutcome> {
  const requestState = host.stateStore.getState();
  const panelTarget = capturePanelTargetLease(requestState);
  const runtimeSnapshot = host.runtimeSnapshotForState(requestState);
  const runtimeConfig = runtimeConfigOrDefault(requestState.connection.runtimeConfig);
  const effect = await host.threadStartPort.startThread({
    serviceTier: serviceTierRequestForThreadStart(runtimeSnapshot, runtimeConfig),
    permissions: permissionProfileRequestForThreadStart(runtimeSnapshot, runtimeConfig),
  });
  if (!effectCompleted(effect)) return { kind: "not-started" };
  const activation = effect.value;
  const fallbackPreview = preview?.trim();
  const thread =
    activation.thread.preview.trim().length > 0 || !fallbackPreview
      ? activation.thread
      : { ...activation.thread, preview: fallbackPreview };
  const patchedActivation = thread === activation.thread ? activation : { ...activation, thread };
  host.recordStartedThread(thread);
  if (!effectCompletedInCurrentContext(effect)) {
    return { kind: "created-not-activated", threadId: activation.thread.id };
  }
  const current = host.stateStore.getState();
  if (
    options.preservePendingSubmissionId &&
    !pendingSubmissionMatches(
      { pendingSubmission: current.pendingSubmission, activeThreadId: activeThreadId(current) },
      options.preservePendingSubmissionId,
    )
  ) {
    return { kind: "created-not-activated", threadId: activation.thread.id };
  }
  if (!panelTargetLeaseIsCurrent(current, panelTarget)) {
    return { kind: "created-not-activated", threadId: activation.thread.id };
  }

  const state = host.stateStore.getState();
  const action = resumedThreadAction({
    response: patchedActivation,
    listedThreads: state.threadList.listedThreads,
    preserveRequestedRuntimeSettings: activeThreadId(requestState) === null,
    expectedPanelTargetRevision: panelTarget.revision,
    ...(options.preservePendingSubmissionId ? { preservePendingSubmissionId: options.preservePendingSubmissionId } : {}),
  });
  const applied = host.stateStore.dispatch(action);
  if (activeThreadId(applied) !== action.thread.id) {
    return { kind: "created-not-activated", threadId: action.thread.id };
  }
  if (options.syncGoal ?? true) host.syncThreadGoal(action.thread.id);
  return { kind: "created-activated", threadId: action.thread.id };
}
