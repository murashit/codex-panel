import { ephemeralThreadActivatedAction } from "../state/actions";
import { effectCompletedInCurrentContext } from "../effect-outcome";
import { activeThreadState } from "../state/root-reducer";
import { capturePanelTargetLease, panelTargetLeaseIsCurrent } from "../state/panel-target";
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
      const panelTarget = capturePanelTargetLease(host.stateStore.getState());
      if (!(await host.ensureConnected())) return false;
      if (disposed || generation !== openGeneration || !panelTargetLeaseIsCurrent(host.stateStore.getState(), panelTarget)) return false;
      const effect = await host.transport.forkEphemeralThread(input.sourceThreadId);
      if (!effectCompletedInCurrentContext(effect)) return false;
      const result = effect.value;
      if (result.kind === "cleanup-required") {
        cleanupRequiredThreadIds.add(result.threadId);
        host.addSystemMessage("Could not prepare the side chat. Cleanup will be retried when this view closes.");
        return false;
      }
      const snapshot = result;
      if (disposed || generation !== openGeneration || !panelTargetLeaseIsCurrent(host.stateStore.getState(), panelTarget)) {
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
      if (active?.lifetime?.kind !== "ephemeral") return true;
      const panelTarget = capturePanelTargetLease(state);
      if (chatTurnBusy(state)) {
        host.addSystemMessage("Finish or interrupt the current turn before switching threads.");
        return false;
      }
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
