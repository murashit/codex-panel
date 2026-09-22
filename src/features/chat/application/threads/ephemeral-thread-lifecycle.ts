import type { ThreadActivationSnapshot } from "../../../../domain/threads/model";
import type { EffectOutcome } from "../effect-outcome";
import { activeThreadState } from "../state/model";
import type { ChatStateStore } from "../state/store";
import { activeTurnId, chatTurnBusy } from "../turns/turn-state";

export type EphemeralThreadForkResult =
  | { kind: "ready"; activation: ThreadActivationSnapshot; sourceThreadId: string }
  | { kind: "cleanup-required"; threadId: string };

export interface EphemeralThreadEffects {
  forkEphemeralThread(sourceThreadId: string): Promise<EphemeralThreadForkResult | null>;
  unsubscribeEphemeralThread(threadId: string): Promise<boolean>;
}

const EPHEMERAL_INTERRUPT_RELEASE_TIMEOUT_MS = 1_000;

export interface EphemeralThreadLifecycle {
  create(sourceThreadId: string, isCurrent: () => boolean): Promise<EffectOutcome<ThreadActivationSnapshot>>;
  prepareForPersistentNavigation(): Promise<boolean>;
  cleanupForConnectionReset(): Promise<void>;
  dispose(): Promise<void>;
}

interface EphemeralThreadLifecycleHost {
  stateStore: ChatStateStore;
  effects: EphemeralThreadEffects;
  ensureConnected(): Promise<boolean>;
  addSystemMessage(text: string): void;
  notifyActiveThreadIdentityChanged(): void;
  interruptTurn(threadId: string, turnId: string): Promise<boolean>;
}

export function createEphemeralThreadLifecycle(host: EphemeralThreadLifecycleHost): EphemeralThreadLifecycle {
  let disposed = false;
  const cleanupRequiredThreadIds = new Set<string>();
  const tryCleanupEphemeralThread = async (threadId: string): Promise<void> => {
    cleanupRequiredThreadIds.add(threadId);
    try {
      if (await host.effects.unsubscribeEphemeralThread(threadId)) cleanupRequiredThreadIds.delete(threadId);
    } catch {
      // Keep the obligation for the next lifecycle boundary.
    }
  };
  const retryRequiredCleanup = async (): Promise<void> => {
    for (const threadId of cleanupRequiredThreadIds) {
      await tryCleanupEphemeralThread(threadId);
    }
  };
  const creationIsStale = (isCurrent: () => boolean): boolean => disposed || !isCurrent();
  const prepareActiveEphemeralThreadForRelease = async (): Promise<void> => {
    const state = host.stateStore.getState();
    const activeThread = activeThreadState(state);
    const threadId = activeThread?.lifetime?.kind === "ephemeral" ? activeThread.id : null;
    const turnId = activeTurnId(state.activeTurn);
    if (threadId && turnId) {
      await settleWithin(host.interruptTurn(threadId, turnId), EPHEMERAL_INTERRUPT_RELEASE_TIMEOUT_MS);
    }
    if (threadId) cleanupRequiredThreadIds.add(threadId);
    await retryRequiredCleanup();
  };

  return {
    async create(sourceThreadId, isCurrent): Promise<EffectOutcome<ThreadActivationSnapshot>> {
      if (creationIsStale(isCurrent)) return { kind: "not-started" };
      if (cleanupRequiredThreadIds.size > 0) {
        await retryRequiredCleanup();
        if (creationIsStale(isCurrent)) return { kind: "not-started" };
      }
      const result = await host.effects.forkEphemeralThread(sourceThreadId);
      if (!result) return { kind: "not-started" };
      if (result.kind === "cleanup-required") {
        await tryCleanupEphemeralThread(result.threadId);
        if (!creationIsStale(isCurrent)) {
          host.addSystemMessage("Could not open the side chat. Please try again.");
        }
        return { kind: "not-started" };
      }
      if (creationIsStale(isCurrent)) {
        await tryCleanupEphemeralThread(result.activation.thread.id);
        return { kind: "not-started" };
      }
      return { kind: "completed", value: result.activation };
    },

    async prepareForPersistentNavigation(): Promise<boolean> {
      const state = host.stateStore.getState();
      const active = activeThreadState(state);
      if (active?.lifetime?.kind !== "ephemeral") {
        await retryRequiredCleanup();
        return true;
      }
      if (chatTurnBusy(state.activeTurn)) {
        host.addSystemMessage("Finish or interrupt the current turn before switching threads.");
        return false;
      }
      if (!(await host.ensureConnected())) return false;
      await retryRequiredCleanup();
      if (activeThreadState(host.stateStore.getState())?.id !== active.id) return false;
      try {
        if (!(await host.effects.unsubscribeEphemeralThread(active.id))) {
          host.addSystemMessage("Could not discard the side chat. Try again before switching threads.");
          return false;
        }
      } catch (error) {
        host.addSystemMessage(error instanceof Error ? error.message : String(error));
        return false;
      }
      if (activeThreadState(host.stateStore.getState())?.id !== active.id) return false;
      host.stateStore.dispatch({ type: "active-thread/cleared" });
      host.notifyActiveThreadIdentityChanged();
      return true;
    },

    cleanupForConnectionReset: prepareActiveEphemeralThreadForRelease,

    async dispose(): Promise<void> {
      disposed = true;
      await prepareActiveEphemeralThreadForRelease();
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
