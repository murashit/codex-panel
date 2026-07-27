import { activeThreadState } from "../state/root-reducer";
import type { ChatStateStore } from "../state/store";
import type { EphemeralThreadLifecycle } from "./ephemeral-thread-lifecycle";

export interface PersistentNavigationLifecycle {
  prepareForPersistentNavigation(targetThreadId: string | null): Promise<PersistentNavigationPreparation | null>;
  commitPersistentNavigation(preparation: PersistentNavigationPreparation): void;
}

export type PersistentNavigationPreparation =
  | { readonly kind: "ready" }
  | { readonly kind: "unsubscribe-on-adoption"; readonly threadId: string };

interface PersistentNavigationLifecycleHost {
  stateStore: ChatStateStore;
  ephemeral: EphemeralThreadLifecycle;
  unsubscribeThread(threadId: string): Promise<boolean>;
  addSystemMessage(text: string): void;
}

export function createPersistentNavigationLifecycle(host: PersistentNavigationLifecycleHost): PersistentNavigationLifecycle {
  const pendingUnsubscribes = new Set<string>();
  const unsubscribeAttempts = new Map<string, Promise<void>>();

  const attemptPendingUnsubscribe = (threadId: string): void => {
    if (!pendingUnsubscribes.has(threadId) || unsubscribeAttempts.has(threadId)) return;
    const attempt = (async (): Promise<void> => {
      try {
        if (await host.unsubscribeThread(threadId)) {
          pendingUnsubscribes.delete(threadId);
          return;
        }
        host.addSystemMessage("Could not unsubscribe from the previous subagent.");
      } catch (error) {
        host.addSystemMessage(error instanceof Error ? error.message : "Could not unsubscribe from the previous subagent.");
      }
    })().finally(() => {
      unsubscribeAttempts.delete(threadId);
    });
    unsubscribeAttempts.set(threadId, attempt);
  };

  const retryPendingUnsubscribes = (): void => {
    for (const threadId of pendingUnsubscribes) attemptPendingUnsubscribe(threadId);
  };

  return {
    async prepareForPersistentNavigation(targetThreadId): Promise<PersistentNavigationPreparation | null> {
      retryPendingUnsubscribes();
      if (targetThreadId !== null && pendingUnsubscribes.has(targetThreadId)) return null;
      const state = host.stateStore.getState();
      const active = activeThreadState(state);
      if (!active || active.id === targetThreadId) return { kind: "ready" };

      if (active.lifetime?.kind === "ephemeral") {
        return (await host.ephemeral.prepareForPersistentNavigation()) ? { kind: "ready" } : null;
      }
      if (active.provenance?.kind !== "subagent") return { kind: "ready" };
      return { kind: "unsubscribe-on-adoption", threadId: active.id };
    },

    commitPersistentNavigation(preparation): void {
      if (preparation.kind !== "unsubscribe-on-adoption") return;
      pendingUnsubscribes.add(preparation.threadId);
      attemptPendingUnsubscribe(preparation.threadId);
    },
  };
}
