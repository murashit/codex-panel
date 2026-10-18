import type { RuntimeServiceTierRequest, RuntimeSettingsPatch } from "../../../../domain/runtime/settings";
import { runtimeConfigOrDefault } from "../../../../domain/runtime/settings";
import type { Thread, ThreadActivationSnapshot } from "../../../../domain/threads/model";
import type { RuntimeSnapshot } from "../../domain/runtime/snapshot";
import { permissionProfileRequestForThreadStart, serviceTierRequestForThreadStart } from "../../domain/runtime/thread-settings-patch";
import type { EffectOutcome } from "../effect-outcome";
import { activeThreadId, type ChatState, newConversationEphemeral } from "../state/model";
import { capturePanelTargetLease, type PanelTargetLease, panelTargetLeaseIsCurrent } from "../state/panel-target";
import type { ChatStateStore } from "../state/store";
import { resumedThreadAction } from "../state/transition-actions";
import { forkRuntimeSettings, type ThreadForkOptions, type ThreadForkRuntimeOverrides } from "./fork-draft";

interface ThreadStartRequest {
  ephemeral?: boolean;
  serviceTier?: RuntimeServiceTierRequest;
  permissions?: RuntimeSettingsPatch["permissions"];
}

export interface ThreadStartEffects {
  forkSideChat: (
    sourceThreadId: string,
    runtime: ThreadForkRuntimeOverrides,
    isCurrent: () => boolean,
  ) => Promise<EffectOutcome<ThreadActivationSnapshot>>;

  forkThread(threadId: string, options: ThreadForkOptions): Promise<EffectOutcome<ThreadActivationSnapshot>>;
  startThread(request: ThreadStartRequest): Promise<EffectOutcome<ThreadActivationSnapshot>>;
}

type ThreadStartOutcome =
  | { readonly kind: "not-started" }
  | { readonly kind: "created-activated"; readonly target: PanelTargetLease & { readonly threadId: string } }
  | { readonly kind: "created-not-activated" };

export interface ThreadStartCommandHost {
  stateStore: ChatStateStore;
  effects: ThreadStartEffects;
  withThreadActivation<T>(operation: () => Promise<T>): Promise<T>;
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
    },
  ) => Promise<ThreadStartOutcome>;
}

export function createThreadStartCommand(host: ThreadStartCommandHost): ThreadStartCommand {
  let creation: { revision: number; promise: Promise<ThreadStartOutcome> } | null = null;
  return {
    startThread: (preview, options) => {
      const state = host.stateStore.getState();
      if (creation?.revision === state.panelTargetRevision) {
        return creation.promise;
      }
      const threadId = activeThreadId(state);
      if (threadId) return Promise.resolve({ kind: "created-activated", target: { revision: state.panelTargetRevision, threadId } });
      const draft = state.panelThread.kind === "fork-draft";
      if (state.panelThread.kind !== "empty" && !draft) return Promise.resolve({ kind: "not-started" });
      if (state.panelThread.operation) return Promise.resolve({ kind: "not-started" });
      if (draft) host.stateStore.dispatch({ type: "panel/fork-operation-set", revision: state.panelTargetRevision, operation: "creating" });
      else host.stateStore.dispatch({ type: "panel/creation-state-set", revision: state.panelTargetRevision, operation: "creating" });
      const promise = startThread(host, preview, options).finally(() => {
        if (creation?.promise === promise) creation = null;
        if (draft) host.stateStore.dispatch({ type: "panel/fork-operation-set", revision: state.panelTargetRevision });
        else {
          const panel = host.stateStore.getState().panelThread;
          if (panel.kind === "empty") host.stateStore.dispatch({ type: "panel/creation-state-set", revision: state.panelTargetRevision });
        }
      });
      creation = { revision: state.panelTargetRevision, promise };
      return promise;
    },
  };
}

async function startThread(
  host: ThreadStartCommandHost,
  preview?: string,
  options: {
    onCreated?: (thread: Thread) => void;
  } = {},
): Promise<ThreadStartOutcome> {
  const requestState = host.stateStore.getState();
  const draft = requestState.panelThread.kind === "fork-draft" ? requestState.panelThread.draft : null;
  const create = async (): Promise<ThreadStartOutcome> => {
    const panelTarget = capturePanelTargetLease(requestState);
    const runtimeSnapshot = host.runtimeSnapshotForState(requestState);
    const runtimeConfig = runtimeConfigOrDefault(runtimeSnapshot.runtimeConfig);
    const active = requestState.runtime.active;
    const sideChat = draft?.kind === "side-chat" ? draft : null;
    const effect = sideChat
      ? await host.effects.forkSideChat(sideChat.sourceThreadId, forkRuntimeSettings(active), () =>
          panelTargetLeaseIsCurrent(host.stateStore.getState(), panelTarget),
        )
      : draft?.kind === "persistent"
        ? await host.effects.forkThread(draft.sourceThreadId, {
            position: draft.boundary,
            deferGoalContinuation: true,
            runtime: forkRuntimeSettings(active),
          })
        : await host.effects.startThread({
            ...(newConversationEphemeral(requestState) ? { ephemeral: true } : {}),
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
    if (!sideChat && !thread.ephemeral) host.recordStartedThread(thread);
    const current = host.stateStore.getState();
    if (!panelTargetLeaseIsCurrent(current, panelTarget)) {
      return { kind: "created-not-activated" };
    }

    const action = {
      ...resumedThreadAction({
        response: patchedActivation,
        preserveRequestedRuntimeSettings: activeThreadId(requestState) === null,
        preserveGoalEditor: requestState.panelThread.kind === "empty",
        expectedPanelTargetRevision: panelTarget.revision,
      }),
      type: "active-thread/created" as const,
      ...(sideChat
        ? {
            lifetime: {
              kind: "ephemeral" as const,
              mode: "side-chat" as const,
              sourceThreadId: sideChat.sourceThreadId,
              sourceThreadTitle: sideChat.sourceThreadTitle,
            },
          }
        : {}),
    };
    const applied = host.stateStore.dispatch(action);
    if (activeThreadId(applied) !== action.thread.id) {
      return { kind: "created-not-activated" };
    }
    return { kind: "created-activated", target: { revision: applied.panelTargetRevision, threadId: action.thread.id } };
  };
  const outcome = await host.withThreadActivation(create);
  if (outcome.kind !== "created-activated") return outcome;
  if (draft?.kind === "persistent") {
    await host.hydrateCreatedFork(outcome.target.threadId);
    if (!panelTargetLeaseIsCurrent(host.stateStore.getState(), outcome.target)) return { kind: "created-not-activated" };
  }
  host.onThreadActivated(draft?.kind === "persistent");
  return outcome;
}
