import { activeThreadState } from "../state/root-reducer";
import type { ChatStateStore } from "../state/store";
import { chatTurnBusy } from "../turns/turn-state";
import type { EphemeralThreadLifecycle } from "./ephemeral-thread-lifecycle";
import type { ThreadSubscriptionTransport } from "./thread-subscription-transport";

export interface PersistentNavigationLifecycle {
  prepareForPersistentNavigation(targetThreadId: string | null): Promise<PersistentNavigationPreparation | null>;
  completePersistentNavigation(preparation: PersistentNavigationPreparation): Promise<void>;
}

export type PersistentNavigationPreparation =
  | { readonly kind: "ready" }
  | { readonly kind: "unsubscribe-after-resume"; readonly threadId: string; readonly targetThreadId: string };

interface PersistentNavigationLifecycleHost {
  stateStore: ChatStateStore;
  ephemeral: EphemeralThreadLifecycle;
  subscriptions: ThreadSubscriptionTransport;
  addSystemMessage(text: string): void;
}

export function createPersistentNavigationLifecycle(host: PersistentNavigationLifecycleHost): PersistentNavigationLifecycle {
  return {
    async prepareForPersistentNavigation(targetThreadId): Promise<PersistentNavigationPreparation | null> {
      const state = host.stateStore.getState();
      const active = activeThreadState(state);
      if (!active || active.id === targetThreadId) return { kind: "ready" };

      if (active.lifetime?.kind === "ephemeral") {
        return (await host.ephemeral.prepareForPersistentNavigation()) ? { kind: "ready" } : null;
      }
      if (active.provenance?.kind !== "subagent" || !chatTurnBusy(state)) return { kind: "ready" };
      if (targetThreadId !== null) {
        return { kind: "unsubscribe-after-resume", threadId: active.id, targetThreadId };
      }

      try {
        if (await host.subscriptions.unsubscribeThread(active.id)) return { kind: "ready" };
        host.addSystemMessage("Could not leave the running subagent. Try again before navigating.");
      } catch (error) {
        host.addSystemMessage(error instanceof Error ? error.message : String(error));
      }
      return null;
    },

    async completePersistentNavigation(preparation): Promise<void> {
      if (preparation.kind !== "unsubscribe-after-resume") return;
      if (activeThreadState(host.stateStore.getState())?.id !== preparation.targetThreadId) return;
      try {
        if (!(await host.subscriptions.unsubscribeThread(preparation.threadId))) {
          host.addSystemMessage("Could not unsubscribe from the previous subagent.");
        }
      } catch (error) {
        host.addSystemMessage(error instanceof Error ? error.message : String(error));
      }
    },
  };
}
