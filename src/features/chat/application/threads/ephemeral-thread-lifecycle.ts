import { ephemeralThreadActivatedAction } from "../state/actions";
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
  const deleteActiveEphemeralThread = async (): Promise<boolean> => {
    const active = host.stateStore.getState().activeThread;
    if (active.id && active.lifetime?.kind === "ephemeral") {
      return host.transport.deleteEphemeralThread(active.id);
    }
    return true;
  };

  return {
    async open(input): Promise<boolean> {
      const generation = ++openGeneration;
      if (!(await host.ensureConnected())) return false;
      const snapshot = await host.transport.forkEphemeralThread(input.sourceThreadId);
      if (!snapshot) return false;
      if (disposed || generation !== openGeneration) {
        try {
          await host.transport.deleteEphemeralThread(snapshot.activation.thread.id);
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
      if (state.activeThread.lifetime?.kind !== "ephemeral") return true;
      if (chatTurnBusy(state)) {
        host.addSystemMessage("Finish or interrupt the current turn before switching threads.");
        return false;
      }
      try {
        if (!(await deleteActiveEphemeralThread())) {
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
      const threadId = state.activeThread.lifetime?.kind === "ephemeral" ? state.activeThread.id : null;
      const turnId = activeTurnId(state);
      if (threadId && turnId) {
        await settleWithin(host.interruptTurn(threadId, turnId), EPHEMERAL_INTERRUPT_DISPOSE_TIMEOUT_MS);
      }
      try {
        await deleteActiveEphemeralThread();
      } catch {
        // Ephemeral cleanup must not prevent the panel from closing.
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
