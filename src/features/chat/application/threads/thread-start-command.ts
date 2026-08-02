import { runtimeConfigOrDefault } from "../../../../domain/runtime/config";
import type { RuntimeServiceTierRequest, RuntimeSettingsPatch } from "../../../../domain/runtime/thread-settings";
import type { ThreadActivationSnapshot } from "../../../../domain/threads/activation";
import type { Thread } from "../../../../domain/threads/model";
import type { RuntimeSnapshot } from "../../domain/runtime/snapshot";
import { permissionProfileRequestForThreadStart, serviceTierRequestForThreadStart } from "../../domain/runtime/thread-settings-patch";
import type { ComposerSubmissionAdoption } from "../composer/submission-claim";
import { type EffectOutcome, effectCompleted } from "../effect-outcome";
import { resumedThreadAction } from "../state/actions";
import { capturePanelTargetLease, panelTargetLeaseIsCurrent } from "../state/panel-target";
import { pendingSubmissionMatches } from "../state/pending-submission";
import { activeThreadId, type ChatState } from "../state/root-reducer";
import type { ChatStateStore } from "../state/store";

interface ThreadStartRequest {
  serviceTier?: RuntimeServiceTierRequest;
  permissions?: RuntimeSettingsPatch["permissions"];
}

export interface ThreadStartEffects {
  startThread(request: ThreadStartRequest): Promise<EffectOutcome<ThreadActivationSnapshot>>;
}

export type ThreadStartOutcome =
  | { readonly kind: "not-started" }
  | { readonly kind: "created-activated"; readonly threadId: string }
  | { readonly kind: "created-not-activated"; readonly threadId: string };

export interface ThreadStartCommandHost {
  stateStore: ChatStateStore;
  effects: ThreadStartEffects;
  runtimeSnapshotForState: (state: ChatState) => RuntimeSnapshot;
  recordStartedThread: (thread: Thread) => void;
  syncThreadGoal: (threadId: string) => void;
}

export interface ThreadStartCommand {
  startThread: (
    preview?: string,
    options?: {
      syncGoal?: boolean;
      preservePendingSubmissionId?: string;
      adoptPanelTarget?: ComposerSubmissionAdoption["adoptPanelTarget"];
    },
  ) => Promise<ThreadStartOutcome>;
}

export function createThreadStartCommand(host: ThreadStartCommandHost): ThreadStartCommand {
  return {
    startThread: (preview, options) => startThread(host, preview, options),
  };
}

async function startThread(
  host: ThreadStartCommandHost,
  preview?: string,
  options: {
    syncGoal?: boolean;
    preservePendingSubmissionId?: string;
    adoptPanelTarget?: ComposerSubmissionAdoption["adoptPanelTarget"];
  } = {},
): Promise<ThreadStartOutcome> {
  const requestState = host.stateStore.getState();
  const panelTarget = capturePanelTargetLease(requestState);
  const runtimeSnapshot = host.runtimeSnapshotForState(requestState);
  const runtimeConfig = runtimeConfigOrDefault(runtimeSnapshot.runtimeConfig);
  const effect = await host.effects.startThread({
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

  const action = resumedThreadAction({
    response: patchedActivation,
    preserveRequestedRuntimeSettings: activeThreadId(requestState) === null,
    expectedPanelTargetRevision: panelTarget.revision,
    ...(options.preservePendingSubmissionId ? { preservePendingSubmissionId: options.preservePendingSubmissionId } : {}),
  });
  options.adoptPanelTarget?.(action.thread.id);
  const applied = host.stateStore.dispatch(action);
  if (activeThreadId(applied) !== action.thread.id) {
    return { kind: "created-not-activated", threadId: action.thread.id };
  }
  if (options.syncGoal ?? true) host.syncThreadGoal(action.thread.id);
  return { kind: "created-activated", threadId: action.thread.id };
}
