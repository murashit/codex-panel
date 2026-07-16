import { ephemeralThreadActivatedAction } from "../state/actions";
import { activeThreadState } from "../state/root-reducer";
import type { ChatStateStore } from "../state/store";
import { activeTurnId, chatTurnBusy } from "../turns/turn-state";
import type { EphemeralThreadTransport } from "./ephemeral-thread-transport";

const EPHEMERAL_INTERRUPT_DISPOSE_TIMEOUT_MS = 1_000;

interface OpenEphemeralThreadInput {
  sourceThreadId: string;
  sourceThreadTitle: string | null;
}

export interface EphemeralThreadLifecycle {
  open(input: OpenEphemeralThreadInput): Promise<boolean>;
  prepareForPersistentNavigation(): Promise<boolean>;
  dispose(): Promise<void>;
}

interface EphemeralThreadLifecycleHost {
  stateStore: ChatStateStore;
  transport: EphemeralThreadTransport;
  ensureConnected(): Promise<boolean>;
  addSystemMessage(text: string): void;
  notifyActiveThreadIdentityChanged(): void;
  interruptTurn(threadId: string, turnId: string): Promise<boolean>;
}

export function createEphemeralThreadLifecycle(host: EphemeralThreadLifecycleHost): EphemeralThreadLifecycle {
  let disposed = false;
  let openGeneration = 0;
  const cleanupRequiredThreadIds = new Set<string>();
  const unsubscribeActiveEphemeralThread = async (): Promise<boolean> => {
    const active = activeThreadState(host.stateStore.getState());
    if (active?.lifetime?.kind === "ephemeral") {
      return host.transport.unsubscribeEphemeralThread(active.id);
    }
    return true;
  };

  return {
    async open(input): Promise<boolean> {
      const generation = ++openGeneration;
      if (!(await host.ensureConnected())) return false;
      const result = await host.transport.forkEphemeralThread(input.sourceThreadId);
      if (!result) return false;
      if (result.kind === "cleanup-required") {
        cleanupRequiredThreadIds.add(result.threadId);
        host.addSystemMessage("Could not prepare the side chat. Cleanup will be retried when this view closes.");
        return false;
      }
      const snapshot = result;
      if (disposed || generation !== openGeneration) {
        try {
          await host.transport.unsubscribeEphemeralThread(snapshot.activation.thread.id);
        } catch {
          // A late fork must never become active, even when best-effort cleanup fails.
        }
        return false;
      }
      host.stateStore.dispatch(
        ephemeralThreadActivatedAction({
          response: snapshot.activation,
          sourceThreadId: input.sourceThreadId,
          sourceThreadTitle: input.sourceThreadTitle,
        }),
      );
      host.notifyActiveThreadIdentityChanged();
      return true;
    },

    async prepareForPersistentNavigation(): Promise<boolean> {
      const state = host.stateStore.getState();
      if (activeThreadState(state)?.lifetime?.kind !== "ephemeral") return true;
      if (chatTurnBusy(state)) {
        host.addSystemMessage("Finish or interrupt the current turn before switching threads.");
        return false;
      }
      try {
        if (!(await unsubscribeActiveEphemeralThread())) {
          host.addSystemMessage("Could not discard the side chat. Try again before switching threads.");
          return false;
        }
      } catch (error) {
        host.addSystemMessage(error instanceof Error ? error.message : String(error));
        return false;
      }
      host.stateStore.dispatch({ type: "active-thread/cleared" });
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
      for (const threadId of cleanupRequiredThreadIds) {
        try {
          if (await host.transport.unsubscribeEphemeralThread(threadId)) cleanupRequiredThreadIds.delete(threadId);
        } catch {
          // Closing the app-server connection provides the final subscription cleanup boundary.
        }
      }
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
