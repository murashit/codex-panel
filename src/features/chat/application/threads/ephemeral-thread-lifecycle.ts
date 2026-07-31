import type { ThreadActivationSnapshot } from "../../../../domain/threads/activation";
import { type EffectOutcome, effectCompletedInCurrentContext } from "../effect-outcome";
import { ephemeralThreadActivatedAction } from "../state/actions";
import { activeThreadState } from "../state/root-reducer";
import type { ChatStateStore } from "../state/store";
import { activeTurnId, chatTurnBusy } from "../turns/turn-state";

export type EphemeralThreadForkResult =
  | { kind: "ready"; activation: ThreadActivationSnapshot; sourceThreadId: string }
  | { kind: "cleanup-required"; threadId: string };

export interface EphemeralThreadEffects {
  forkEphemeralThread(sourceThreadId: string): Promise<EffectOutcome<EphemeralThreadForkResult>>;
  unsubscribeEphemeralThread(threadId: string): Promise<boolean>;
}

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
  const openIsStale = (isCurrent: () => boolean): boolean => disposed || !isCurrent();
  const unsubscribeActiveEphemeralThread = async (): Promise<boolean> => {
    const active = activeThreadState(host.stateStore.getState());
    if (active?.lifetime?.kind === "ephemeral") {
      return host.effects.unsubscribeEphemeralThread(active.id);
    }
    return true;
  };

  return {
    async open(input, options = {}): Promise<boolean> {
      const isCurrent = options.isCurrent ?? (() => true);
      if (!(await host.ensureConnected())) return false;
      if (openIsStale(isCurrent)) return false;
      if (cleanupRequiredThreadIds.size > 0) {
        await retryRequiredCleanup();
        if (openIsStale(isCurrent)) return false;
      }
      const effect = await host.effects.forkEphemeralThread(input.sourceThreadId);
      if (!effectCompletedInCurrentContext(effect)) return false;
      const result = effect.value;
      if (result.kind === "cleanup-required") {
        await tryCleanupEphemeralThread(result.threadId);
        if (!openIsStale(isCurrent)) {
          host.addSystemMessage("Could not open the side chat. Please try again.");
        }
        return false;
      }
      const snapshot = result;
      if (openIsStale(isCurrent)) {
        await tryCleanupEphemeralThread(snapshot.activation.thread.id);
        return false;
      }
      host.stateStore.dispatch(
        ephemeralThreadActivatedAction({
          response: snapshot.activation,
          sourceThreadId: input.sourceThreadId,
          sourceThreadTitle: input.sourceThreadTitle,
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

    async dispose(): Promise<void> {
      disposed = true;
      const state = host.stateStore.getState();
      const activeThread = activeThreadState(state);
      const threadId = activeThread?.lifetime?.kind === "ephemeral" ? activeThread.id : null;
      const turnId = activeTurnId(state.activeTurn);
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
