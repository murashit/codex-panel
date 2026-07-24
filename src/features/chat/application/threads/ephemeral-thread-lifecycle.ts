import { effectCompletedInCurrentContext } from "../effect-outcome";
import { ephemeralThreadActivatedAction } from "../state/actions";
import { capturePanelTargetLease, panelTargetLeaseIsCurrent } from "../state/panel-target";
import { activeThreadState } from "../state/root-reducer";
import type { ChatStateStore } from "../state/store";
import { activeTurnId, chatTurnBusy } from "../turns/turn-state";
import type { EphemeralThreadPort } from "./ephemeral-thread-port";

const EPHEMERAL_INTERRUPT_DISPOSE_TIMEOUT_MS = 1_000;

interface OpenEphemeralThreadInput {
  sourceThreadId: string;
  sourceThreadTitle: string | null;
}

export interface EphemeralThreadLifecycle {
  open(input: OpenEphemeralThreadInput, options?: { isCurrent?: () => boolean }): Promise<boolean>;
  prepareForPersistentNavigation(): Promise<boolean>;
  dispose(): Promise<void>;
}

interface EphemeralThreadLifecycleHost {
  stateStore: ChatStateStore;
  port: EphemeralThreadPort;
  ensureConnected(): Promise<boolean>;
  addSystemMessage(text: string): void;
  notifyActiveThreadIdentityChanged(): void;
  interruptTurn(threadId: string, turnId: string): Promise<boolean>;
}

export function createEphemeralThreadLifecycle(host: EphemeralThreadLifecycleHost): EphemeralThreadLifecycle {
  let disposed = false;
  let openGeneration = 0;
  const cleanupRequiredThreadIds = new Set<string>();
  const tryCleanupEphemeralThread = async (threadId: string): Promise<void> => {
    cleanupRequiredThreadIds.add(threadId);
    try {
      if (await host.port.unsubscribeEphemeralThread(threadId)) cleanupRequiredThreadIds.delete(threadId);
    } catch {
      // Keep the obligation for the next lifecycle boundary.
    }
  };
  const retryRequiredCleanup = async (): Promise<void> => {
    for (const threadId of cleanupRequiredThreadIds) {
      await tryCleanupEphemeralThread(threadId);
    }
  };
  const openIsStale = (generation: number, panelTarget: ReturnType<typeof capturePanelTargetLease>, isCurrent: () => boolean): boolean =>
    disposed || generation !== openGeneration || !isCurrent() || !panelTargetLeaseIsCurrent(host.stateStore.getState(), panelTarget);
  const unsubscribeActiveEphemeralThread = async (): Promise<boolean> => {
    const active = activeThreadState(host.stateStore.getState());
    if (active?.lifetime?.kind === "ephemeral") {
      return host.port.unsubscribeEphemeralThread(active.id);
    }
    return true;
  };

  return {
    async open(input, options = {}): Promise<boolean> {
      const generation = ++openGeneration;
      const isCurrent = options.isCurrent ?? (() => true);
      const panelTarget = capturePanelTargetLease(host.stateStore.getState());
      if (!(await host.ensureConnected())) return false;
      if (openIsStale(generation, panelTarget, isCurrent)) return false;
      if (cleanupRequiredThreadIds.size > 0) {
        await retryRequiredCleanup();
        if (openIsStale(generation, panelTarget, isCurrent)) return false;
      }
      const effect = await host.port.forkEphemeralThread(input.sourceThreadId);
      if (!effectCompletedInCurrentContext(effect)) return false;
      const result = effect.value;
      if (result.kind === "cleanup-required") {
        await tryCleanupEphemeralThread(result.threadId);
        if (!openIsStale(generation, panelTarget, isCurrent)) {
          host.addSystemMessage("Could not open the side chat. Please try again.");
        }
        return false;
      }
      const snapshot = result;
      if (openIsStale(generation, panelTarget, isCurrent)) {
        await tryCleanupEphemeralThread(snapshot.activation.thread.id);
        return false;
      }
      host.stateStore.dispatch(
        ephemeralThreadActivatedAction({
          response: snapshot.activation,
          sourceThreadId: input.sourceThreadId,
          sourceThreadTitle: input.sourceThreadTitle,
          expectedPanelTargetRevision: panelTarget.revision,
        }),
      );
      if (activeThreadState(host.stateStore.getState())?.id !== snapshot.activation.thread.id) return false;
      host.notifyActiveThreadIdentityChanged();
      return true;
    },

    async prepareForPersistentNavigation(): Promise<boolean> {
      const state = host.stateStore.getState();
      const active = activeThreadState(state);
      if (active?.lifetime?.kind !== "ephemeral") {
        await retryRequiredCleanup();
        return true;
      }
      const panelTarget = capturePanelTargetLease(state);
      if (chatTurnBusy(state)) {
        host.addSystemMessage("Finish or interrupt the current turn before switching threads.");
        return false;
      }
      if (!(await host.ensureConnected()) || !panelTargetLeaseIsCurrent(host.stateStore.getState(), panelTarget)) return false;
      await retryRequiredCleanup();
      if (!panelTargetLeaseIsCurrent(host.stateStore.getState(), panelTarget)) return false;
      try {
        if (!(await unsubscribeActiveEphemeralThread())) {
          if (!panelTargetLeaseIsCurrent(host.stateStore.getState(), panelTarget)) return false;
          host.addSystemMessage("Could not discard the side chat. Try again before switching threads.");
          return false;
        }
      } catch (error) {
        if (!panelTargetLeaseIsCurrent(host.stateStore.getState(), panelTarget)) return false;
        host.addSystemMessage(error instanceof Error ? error.message : String(error));
        return false;
      }
      if (!panelTargetLeaseIsCurrent(host.stateStore.getState(), panelTarget)) return false;
      host.stateStore.dispatch({ type: "active-thread/cleared", expectedPanelTargetRevision: panelTarget.revision });
      host.notifyActiveThreadIdentityChanged();
      return true;
    },

    async dispose(): Promise<void> {
      disposed = true;
      openGeneration += 1;
      const state = host.stateStore.getState();
      const activeThread = activeThreadState(state);
      const threadId = activeThread?.lifetime?.kind === "ephemeral" ? activeThread.id : null;
      const turnId = activeTurnId(state);
      if (threadId && turnId) {
        await settleWithin(host.interruptTurn(threadId, turnId), EPHEMERAL_INTERRUPT_DISPOSE_TIMEOUT_MS);
      }
      try {
        await unsubscribeActiveEphemeralThread();
      } catch {
        // Ephemeral cleanup must not prevent the panel from closing.
      }
      await retryRequiredCleanup();
    },
  };
}

async function settleWithin(operation: Promise<unknown>, timeoutMs: number): Promise<void> {
  const timeout = AbortSignal.timeout(timeoutMs);
  await Promise.race([
    operation.catch(() => undefined),
    new Promise<void>((resolve) => {
      timeout.addEventListener(
        "abort",
        () => {
          resolve();
        },
        { once: true },
      );
    }),
  ]);
}
