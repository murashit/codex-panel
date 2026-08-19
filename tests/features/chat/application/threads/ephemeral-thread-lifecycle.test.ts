import { describe, expect, it, vi } from "vitest";
import type { ThreadActivationSnapshot } from "../../../../../src/domain/threads/activation";
import { activeThreadId, activeThreadState } from "../../../../../src/features/chat/application/state/model";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import {
  createEphemeralThreadLifecycle,
  type EphemeralThreadEffects,
} from "../../../../../src/features/chat/application/threads/ephemeral-thread-lifecycle";
import { deferred } from "../../../../support/async";

describe("ephemeral thread lifecycle", () => {
  it("activates an ephemeral fork without adding it to the thread list", async () => {
    const store = createChatStateStore();
    const port = transportMock();
    const lifecycle = createEphemeralThreadLifecycle({
      stateStore: store,
      effects: port,
      ensureConnected: vi.fn().mockResolvedValue(true),
      addSystemMessage: vi.fn(),
      notifyActiveThreadIdentityChanged: vi.fn(),
      interruptTurn: vi.fn().mockResolvedValue(true),
    });

    await expect(lifecycle.open({ sourceThreadId: "source", sourceThreadTitle: "Source" })).resolves.toBe(true);

    expect(port.forkEphemeralThread).toHaveBeenCalledWith("source");
    expect(activeThreadState(store.getState())).toMatchObject({
      id: "side",
      lifetime: { kind: "ephemeral", sourceThreadId: "source", sourceThreadTitle: "Source" },
    });
    expect(store.getState()).not.toHaveProperty("threadList");
  });

  it("unsubscribes an idle ephemeral thread before persistent navigation", async () => {
    const store = createChatStateStore();
    const port = transportMock();
    const lifecycle = createEphemeralThreadLifecycle({
      stateStore: store,
      effects: port,
      ensureConnected: vi.fn().mockResolvedValue(true),
      addSystemMessage: vi.fn(),
      notifyActiveThreadIdentityChanged: vi.fn(),
      interruptTurn: vi.fn().mockResolvedValue(true),
    });
    await lifecycle.open({ sourceThreadId: "source", sourceThreadTitle: null });

    await expect(lifecycle.prepareForPersistentNavigation()).resolves.toBe(true);

    expect(port.unsubscribeEphemeralThread).toHaveBeenCalledWith("side");
    expect(activeThreadId(store.getState())).toBeNull();
  });

  it("interrupts a running side turn before close cleanup", async () => {
    const store = createChatStateStore();
    const port = transportMock();
    const interruptTurn = vi.fn().mockResolvedValue(true);
    const lifecycle = createEphemeralThreadLifecycle({
      stateStore: store,
      effects: port,
      ensureConnected: vi.fn().mockResolvedValue(true),
      addSystemMessage: vi.fn(),
      notifyActiveThreadIdentityChanged: vi.fn(),
      interruptTurn,
    });
    await lifecycle.open({ sourceThreadId: "source", sourceThreadTitle: null });
    store.dispatch({ type: "turn/started", threadId: "side", turnId: "turn" });

    await lifecycle.dispose();

    expect(interruptTurn).toHaveBeenCalledWith("side", "turn");
    expect(port.unsubscribeEphemeralThread).toHaveBeenCalledWith("side");
  });

  it("unsubscribes a fork that resolves after the lifecycle is disposed without activating it", async () => {
    const store = createChatStateStore();
    let resolveFork!: (value: Awaited<ReturnType<EphemeralThreadEffects["forkEphemeralThread"]>>) => void;
    const port = transportMock();
    port.forkEphemeralThread = vi.fn(
      () =>
        new Promise<Awaited<ReturnType<EphemeralThreadEffects["forkEphemeralThread"]>>>((resolve) => {
          resolveFork = resolve;
        }),
    );
    const lifecycle = createEphemeralThreadLifecycle({
      stateStore: store,
      effects: port,
      ensureConnected: vi.fn().mockResolvedValue(true),
      addSystemMessage: vi.fn(),
      notifyActiveThreadIdentityChanged: vi.fn(),
      interruptTurn: vi.fn().mockResolvedValue(true),
    });

    const opening = lifecycle.open({ sourceThreadId: "source", sourceThreadTitle: "Source" });
    await Promise.resolve();
    await lifecycle.dispose();
    resolveFork({ kind: "ready", sourceThreadId: "source", activation: activationFixture() });

    await expect(opening).resolves.toBe(false);
    expect(port.unsubscribeEphemeralThread).toHaveBeenCalledWith("side");
    expect(activeThreadId(store.getState())).toBeNull();
  });

  it("unsubscribes a cleanup-required fork that resolves after disposal", async () => {
    const store = createChatStateStore();
    const fork = deferred<Awaited<ReturnType<EphemeralThreadEffects["forkEphemeralThread"]>>>();
    const port = transportMock();
    port.forkEphemeralThread = vi.fn(() => fork.promise);
    const lifecycle = createEphemeralThreadLifecycle({
      stateStore: store,
      effects: port,
      ensureConnected: vi.fn().mockResolvedValue(true),
      addSystemMessage: vi.fn(),
      notifyActiveThreadIdentityChanged: vi.fn(),
      interruptTurn: vi.fn().mockResolvedValue(true),
    });

    const opening = lifecycle.open({ sourceThreadId: "source", sourceThreadTitle: null });
    await Promise.resolve();
    await lifecycle.dispose();
    fork.resolve({ kind: "cleanup-required", threadId: "side" });

    await expect(opening).resolves.toBe(false);
    expect(port.unsubscribeEphemeralThread).toHaveBeenCalledWith("side");
  });

  it.each(["false", "reject"] as const)(
    "retains stale-fork cleanup after unsubscribe %s and retries it at the next lifecycle boundary",
    async (failure) => {
      const store = createChatStateStore();
      let current = true;
      const fork = deferred<Awaited<ReturnType<EphemeralThreadEffects["forkEphemeralThread"]>>>();
      const port = transportMock();
      port.forkEphemeralThread = vi.fn(() => fork.promise);
      port.unsubscribeEphemeralThread =
        failure === "false"
          ? vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true)
          : vi.fn().mockRejectedValueOnce(new Error("connection unavailable")).mockResolvedValue(true);
      const lifecycle = createEphemeralThreadLifecycle({
        stateStore: store,
        effects: port,
        ensureConnected: vi.fn().mockResolvedValue(true),
        addSystemMessage: vi.fn(),
        notifyActiveThreadIdentityChanged: vi.fn(),
        interruptTurn: vi.fn().mockResolvedValue(true),
      });

      const opening = lifecycle.open({ sourceThreadId: "source", sourceThreadTitle: null }, { isCurrent: () => current });
      await vi.waitFor(() => expect(port.forkEphemeralThread).toHaveBeenCalledOnce());
      current = false;
      store.dispatch({ type: "panel/view-state-cleared" });
      fork.resolve({ kind: "ready", sourceThreadId: "source", activation: activationFixture() });

      await expect(opening).resolves.toBe(false);
      expect(port.unsubscribeEphemeralThread).toHaveBeenCalledTimes(1);
      expect(activeThreadId(store.getState())).toBeNull();

      await expect(lifecycle.prepareForPersistentNavigation()).resolves.toBe(true);
      expect(port.unsubscribeEphemeralThread).toHaveBeenCalledTimes(2);
      expect(port.unsubscribeEphemeralThread).toHaveBeenLastCalledWith("side");
    },
  );

  it("still unsubscribes the side chat when interrupting its running turn fails", async () => {
    const store = createChatStateStore();
    const port = transportMock();
    const lifecycle = createEphemeralThreadLifecycle({
      stateStore: store,
      effects: port,
      ensureConnected: vi.fn().mockResolvedValue(true),
      addSystemMessage: vi.fn(),
      notifyActiveThreadIdentityChanged: vi.fn(),
      interruptTurn: vi.fn().mockRejectedValue(new Error("interrupt failed")),
    });
    await lifecycle.open({ sourceThreadId: "source", sourceThreadTitle: null });
    store.dispatch({ type: "turn/started", threadId: "side", turnId: "turn" });

    await lifecycle.dispose();

    expect(port.unsubscribeEphemeralThread).toHaveBeenCalledWith("side");
  });

  it("continues close cleanup when interrupting a running side turn does not settle", async () => {
    vi.useFakeTimers();
    try {
      const store = createChatStateStore();
      const port = transportMock();
      const lifecycle = createEphemeralThreadLifecycle({
        stateStore: store,
        effects: port,
        ensureConnected: vi.fn().mockResolvedValue(true),
        addSystemMessage: vi.fn(),
        notifyActiveThreadIdentityChanged: vi.fn(),
        interruptTurn: vi.fn(() => new Promise<boolean>(() => undefined)),
      });
      await lifecycle.open({ sourceThreadId: "source", sourceThreadTitle: null });
      store.dispatch({ type: "turn/started", threadId: "side", turnId: "turn" });

      const disposal = lifecycle.dispose();
      await vi.advanceTimersByTimeAsync(1_000);
      await disposal;

      expect(port.unsubscribeEphemeralThread).toHaveBeenCalledWith("side");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the side chat active when unsubscribe fails before navigation", async () => {
    const store = createChatStateStore();
    const port = transportMock();
    port.unsubscribeEphemeralThread = vi.fn().mockResolvedValue(false);
    const addSystemMessage = vi.fn();
    const lifecycle = createEphemeralThreadLifecycle({
      stateStore: store,
      effects: port,
      ensureConnected: vi.fn().mockResolvedValue(true),
      addSystemMessage,
      notifyActiveThreadIdentityChanged: vi.fn(),
      interruptTurn: vi.fn().mockResolvedValue(true),
    });
    await lifecycle.open({ sourceThreadId: "source", sourceThreadTitle: null });

    await expect(lifecycle.prepareForPersistentNavigation()).resolves.toBe(false);

    expect(activeThreadId(store.getState())).toBe("side");
    expect(addSystemMessage).toHaveBeenCalledWith("Could not discard the side chat. Try again before switching threads.");
  });

  it("retries cleanup-required forks when the side view is disposed", async () => {
    const store = createChatStateStore();
    const port = transportMock();
    port.forkEphemeralThread = vi.fn().mockResolvedValue({ kind: "cleanup-required", threadId: "side" });
    port.unsubscribeEphemeralThread = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    const addSystemMessage = vi.fn();
    const lifecycle = createEphemeralThreadLifecycle({
      stateStore: store,
      effects: port,
      ensureConnected: vi.fn().mockResolvedValue(true),
      addSystemMessage,
      notifyActiveThreadIdentityChanged: vi.fn(),
      interruptTurn: vi.fn().mockResolvedValue(true),
    });

    await expect(lifecycle.open({ sourceThreadId: "source", sourceThreadTitle: null })).resolves.toBe(false);
    await lifecycle.dispose();

    expect(addSystemMessage).toHaveBeenCalledWith("Could not open the side chat. Please try again.");
    expect(port.unsubscribeEphemeralThread).toHaveBeenCalledTimes(2);
    expect(port.unsubscribeEphemeralThread).toHaveBeenLastCalledWith("side");
  });
});

function transportMock(): EphemeralThreadEffects {
  return {
    forkEphemeralThread: vi.fn().mockResolvedValue({
      kind: "ready",
      sourceThreadId: "source",
      activation: activationFixture(),
    }),
    unsubscribeEphemeralThread: vi.fn().mockResolvedValue(true),
  };
}

function activationFixture(): ThreadActivationSnapshot {
  return {
    thread: {
      id: "side",
      historyMode: "paginated",
      preview: "",
      name: null,
      archived: false,
      createdAt: 1,
      updatedAt: 1,
      provenance: { kind: "interactive" },
    },
    model: "gpt-5.5",
    serviceTier: null,
    approvalsReviewer: null,
    reasoningEffort: null,
    approvalPolicyKnown: true,
    sandboxPolicyKnown: true,
    permissionProfileKnown: true,
    approvalPolicy: "never",
    sandboxPolicy: { type: "readOnly", networkAccess: false },
    activePermissionProfile: null,
  };
}
