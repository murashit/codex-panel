import type { RuntimeServiceTierRequest, RuntimeSettingsPatch } from "../../../../domain/runtime/settings";
import { runtimeConfigOrDefault } from "../../../../domain/runtime/settings";
import type { Thread, ThreadActivationSnapshot } from "../../../../domain/threads/model";
import type { RuntimeSnapshot } from "../../domain/runtime/snapshot";
import { permissionProfileRequestForThreadStart, serviceTierRequestForThreadStart } from "../../domain/runtime/thread-settings-patch";
import type { EffectOutcome } from "../effect-outcome";
import { activeThreadId, type ChatState } from "../state/model";
import { capturePanelTargetLease, type PanelTargetLease, panelTargetLeaseIsCurrent } from "../state/panel-target";
import { pendingSubmissionMatches } from "../state/pending-submission";
import type { ChatStateStore } from "../state/store";
import { resumedThreadAction } from "../state/transition-actions";
import type { ComposerSubmissionAdoption } from "../submission/input-claim";
import type { ThreadForkOptions } from "./fork-draft";

interface ThreadStartRequest {
  serviceTier?: RuntimeServiceTierRequest;
  permissions?: RuntimeSettingsPatch["permissions"];
}

export interface ThreadStartEffects {
  forkThread(threadId: string, options: ThreadForkOptions): Promise<EffectOutcome<ThreadActivationSnapshot>>;
  startThread(request: ThreadStartRequest): Promise<EffectOutcome<ThreadActivationSnapshot>>;
}

export type ThreadStartOutcome =
  | { readonly kind: "not-started" }
  | { readonly kind: "created-activated"; readonly target: PanelTargetLease & { readonly threadId: string } }
  | { readonly kind: "created-not-activated" };

export interface ThreadStartCommandHost {
  stateStore: ChatStateStore;
  effects: ThreadStartEffects;
  runtimeSnapshotForState: (state: ChatState) => RuntimeSnapshot;
  recordStartedThread: (thread: Thread) => void;
  hydrateCreatedFork: (threadId: string) => Promise<void>;
  onThreadActivated: (hadTurns: boolean) => void;
}

export interface ThreadStartCommand {
  startThread: (
    preview?: string,
    options?: {
      onCreated?: (thread: Thread) => void;
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
    onCreated?: (thread: Thread) => void;
    preservePendingSubmissionId?: string;
    adoptPanelTarget?: ComposerSubmissionAdoption["adoptPanelTarget"];
  } = {},
): Promise<ThreadStartOutcome> {
  const requestState = host.stateStore.getState();
  const panelTarget = capturePanelTargetLease(requestState);
  const runtimeSnapshot = host.runtimeSnapshotForState(requestState);
  const runtimeConfig = runtimeConfigOrDefault(runtimeSnapshot.runtimeConfig);
  const draft = requestState.panelThread.kind === "fork-draft" ? requestState.panelThread.draft : null;
  const active = requestState.runtime.active;
  const effect = draft
    ? await host.effects.forkThread(draft.sourceThreadId, {
        position: draft.boundary,
        deferGoalContinuation: true,
        runtime: {
          ...(active.model ? { model: active.model } : {}),
          reasoningEffort: active.reasoningEffort,
          ...(active.serviceTierKnown ? { serviceTier: active.serviceTier } : {}),
          ...(active.approvalPolicyKnown && active.approvalPolicy ? { approvalPolicy: active.approvalPolicy } : {}),
          ...(active.approvalsReviewer ? { approvalsReviewer: active.approvalsReviewer } : {}),
          ...(active.permissionProfileKnown && active.activePermissionProfile
            ? { permissions: active.activePermissionProfile.id }
            : active.sandboxPolicyKnown && active.sandboxPolicy
              ? { sandboxPolicy: active.sandboxPolicy }
              : {}),
        },
      })
    : await host.effects.startThread({
        serviceTier: serviceTierRequestForThreadStart(runtimeSnapshot, runtimeConfig),
        permissions: permissionProfileRequestForThreadStart(runtimeSnapshot, runtimeConfig),
      });
  if (effect.kind === "not-started") return { kind: "not-started" };
  const activation = effect.value;
  const fallbackPreview = preview?.trim();
  const thread =
    activation.thread.preview.trim().length > 0 || !fallbackPreview
      ? activation.thread
      : { ...activation.thread, preview: fallbackPreview };
  const patchedActivation = thread === activation.thread ? activation : { ...activation, thread };
  options.onCreated?.(thread);
  host.recordStartedThread(thread);
  const current = host.stateStore.getState();
  if (
    options.preservePendingSubmissionId &&
    !pendingSubmissionMatches(
      { pendingSubmission: current.pendingSubmission, activeThreadId: activeThreadId(current) },
      options.preservePendingSubmissionId,
    )
  ) {
    return { kind: "created-not-activated" };
  }
  if (!panelTargetLeaseIsCurrent(current, panelTarget)) {
    return { kind: "created-not-activated" };
  }

  const action = {
    ...resumedThreadAction({
      response: patchedActivation,
      preserveRequestedRuntimeSettings: activeThreadId(requestState) === null,
      preserveGoalEditor: requestState.panelThread.kind === "empty",
      expectedPanelTargetRevision: panelTarget.revision,
      ...(options.preservePendingSubmissionId ? { preservePendingSubmissionId: options.preservePendingSubmissionId } : {}),
    }),
    type: "active-thread/created" as const,
  };
  options.adoptPanelTarget?.(action.thread.id);
  const applied = host.stateStore.dispatch(action);
  if (activeThreadId(applied) !== action.thread.id) {
    return { kind: "created-not-activated" };
  }
  const activatedTarget = { revision: applied.panelTargetRevision, threadId: action.thread.id };
  if (draft) {
    await host.hydrateCreatedFork(action.thread.id);
    if (!panelTargetLeaseIsCurrent(host.stateStore.getState(), activatedTarget)) {
      return { kind: "created-not-activated" };
    }
  }
  host.onThreadActivated(draft !== null);
  return { kind: "created-activated", target: activatedTarget };
}
