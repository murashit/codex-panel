import { runtimeConfigOrDefault } from "../../../../domain/runtime/config";
import type { Thread } from "../../../../domain/threads/model";
import type { RuntimeSnapshot } from "../../domain/runtime/snapshot";
import { permissionProfileRequestForThreadStart, serviceTierRequestForThreadStart } from "../../domain/runtime/thread-settings-patch";
import { resumedThreadAction } from "../state/actions";
import { pendingSubmissionMatches } from "../state/pending-submission";
import { activeThreadId, type ChatState } from "../state/root-reducer";
import type { ChatStateStore } from "../state/store";
import type { ThreadStartTransport } from "./thread-start-transport";

interface StartedThreadSummary {
  threadId: string;
}

export interface ThreadStartActionsHost {
  stateStore: ChatStateStore;
  threadStartTransport: ThreadStartTransport;
  runtimeSnapshotForState: (state: ChatState) => RuntimeSnapshot;
  recordStartedThread: (thread: Thread) => void;
  syncThreadGoal: (threadId: string) => void;
}

export interface ThreadStartActions {
  startThread: (
    preview?: string,
    options?: { syncGoal?: boolean; preservePendingSubmissionId?: string },
  ) => Promise<StartedThreadSummary | null>;
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
): Promise<StartedThreadSummary | null> {
  const requestState = host.stateStore.getState();
  const runtimeSnapshot = host.runtimeSnapshotForState(requestState);
  const runtimeConfig = runtimeConfigOrDefault(requestState.connection.runtimeConfig);
  const activation = await host.threadStartTransport.startThread({
    serviceTier: serviceTierRequestForThreadStart(runtimeSnapshot, runtimeConfig),
    permissions: permissionProfileRequestForThreadStart(runtimeSnapshot, runtimeConfig),
  });
  if (!activation) return null;
  const current = host.stateStore.getState();
  if (
    options.preservePendingSubmissionId &&
    !pendingSubmissionMatches(
      { pendingSubmission: current.pendingSubmission, activeThreadId: activeThreadId(current) },
      options.preservePendingSubmissionId,
    )
  ) {
    return null;
  }

  const state = host.stateStore.getState();
  const fallbackPreview = preview?.trim();
  const thread =
    activation.thread.preview.trim().length > 0 || !fallbackPreview
      ? activation.thread
      : { ...activation.thread, preview: fallbackPreview };
  const patchedActivation = thread === activation.thread ? activation : { ...activation, thread };
  const action = resumedThreadAction({
    response: patchedActivation,
    listedThreads: state.threadList.listedThreads,
    preserveRequestedRuntimeSettings: activeThreadId(requestState) === null,
    ...(options.preservePendingSubmissionId ? { preservePendingSubmissionId: options.preservePendingSubmissionId } : {}),
  });
  host.stateStore.dispatch(action);
  host.recordStartedThread(action.thread);
  if (options.syncGoal ?? true) host.syncThreadGoal(action.thread.id);
  return { threadId: action.thread.id };
}
