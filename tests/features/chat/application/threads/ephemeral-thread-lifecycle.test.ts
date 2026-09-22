import { describe, expect, it, vi } from "vitest";
import type { ThreadActivationSnapshot } from "../../../../../src/domain/threads/model";
import { activeThreadId } from "../../../../../src/features/chat/application/state/model";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { resumedThreadAction } from "../../../../../src/features/chat/application/state/transition-actions";
import {
  createEphemeralThreadLifecycle,
  type EphemeralThreadEffects,
} from "../../../../../src/features/chat/application/threads/ephemeral-thread-lifecycle";
import { deferred } from "../../../../support/async";

describe("ephemeral thread lifecycle", () => {
  it("returns the prepared fork without activating it", async () => {
    const store = createChatStateStore();
    const port = transportMock();
    port.forkEphemeralThread = vi.fn().mockResolvedValue({
      kind: "ready",
      sourceThreadId: "source",
      activation: activationFixture({ canAcceptDirectInput: false }),
    });
    const lifecycle = createEphemeralThreadLifecycle({
      stateStore: store,
      effects: port,
      ensureConnected: vi.fn().mockResolvedValue(true),
      addSystemMessage: vi.fn(),
      notifyActiveThreadIdentityChanged: vi.fn(),
      interruptTurn: vi.fn().mockResolvedValue(true),
    });

    await expect(lifecycle.create("source", () => true)).resolves.toEqual({
      kind: "completed",
      value: activationFixture({ canAcceptDirectInput: false }),
    });

    expect(port.forkEphemeralThread).toHaveBeenCalledWith("source");
    expect(activeThreadId(store.getState())).toBeNull();
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
    activateSideThread(store);

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
    activateSideThread(store);
    store.dispatch({ type: "turn/started", threadId: "side", turnId: "turn" });

    await lifecycle.dispose();

    expect(interruptTurn).toHaveBeenCalledWith("side", "turn");
    expect(port.unsubscribeEphemeralThread).toHaveBeenCalledWith("side");
  });

  it("cleans up a running side thread before a connection reset without disposing the panel lifecycle", async () => {
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
    activateSideThread(store);
    store.dispatch({ type: "turn/started", threadId: "side", turnId: "turn" });

    await lifecycle.cleanupForConnectionReset();

    expect(interruptTurn).toHaveBeenCalledWith("side", "turn");
    expect(port.unsubscribeEphemeralThread).toHaveBeenCalledWith("side");
    expect(interruptTurn.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(port.unsubscribeEphemeralThread).mock.invocationCallOrder[0] ?? 0,
    );
    expect(activeThreadId(store.getState())).toBe("side");

    store.dispatch({ type: "active-thread/cleared" });
    await expect(lifecycle.create("source-2", () => true)).resolves.toEqual({ kind: "completed", value: activationFixture() });
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

    const opening = lifecycle.create("source", () => true);
    await Promise.resolve();
    await lifecycle.dispose();
    resolveFork({ kind: "ready", sourceThreadId: "source", activation: activationFixture() });

    await expect(opening).resolves.toEqual({ kind: "not-started" });
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

    const opening = lifecycle.create("source", () => true);
    await Promise.resolve();
    await lifecycle.dispose();
    fork.resolve({ kind: "cleanup-required", threadId: "side" });

    await expect(opening).resolves.toEqual({ kind: "not-started" });
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

      const opening = lifecycle.create("source", () => current);
      await vi.waitFor(() => expect(port.forkEphemeralThread).toHaveBeenCalledOnce());
      current = false;
      store.dispatch({ type: "panel/view-state-cleared" });
      fork.resolve({ kind: "ready", sourceThreadId: "source", activation: activationFixture() });

      await expect(opening).resolves.toEqual({ kind: "not-started" });
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
    activateSideThread(store);
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
      activateSideThread(store);
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
    activateSideThread(store);

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

    await expect(lifecycle.create("source", () => true)).resolves.toEqual({ kind: "not-started" });
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

function activationFixture(overrides: Partial<ThreadActivationSnapshot> = {}): ThreadActivationSnapshot {
  return {
    thread: {
      id: "side",
      preview: "",
      name: null,
      archived: false,
      createdAt: 1,
      updatedAt: 1,
      provenance: { kind: "interactive" },
    },
    canAcceptDirectInput: null,
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
    ...overrides,
  };
}

function activateSideThread(store: ReturnType<typeof createChatStateStore>): void {
  store.dispatch({
    ...resumedThreadAction({ response: activationFixture() }),
    lifetime: { kind: "ephemeral", sourceThreadId: "source", sourceThreadTitle: null },
  });
}
