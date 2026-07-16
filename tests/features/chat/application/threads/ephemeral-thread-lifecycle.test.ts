import { describe, expect, it, vi } from "vitest";
import type { ThreadActivationSnapshot } from "../../../../../src/domain/threads/activation";
import { activeThreadId, activeThreadState } from "../../../../../src/features/chat/application/state/root-reducer";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { createEphemeralThreadLifecycle } from "../../../../../src/features/chat/application/threads/ephemeral-thread-lifecycle";
import type { EphemeralThreadTransport } from "../../../../../src/features/chat/application/threads/ephemeral-thread-transport";

describe("ephemeral thread lifecycle", () => {
  it("activates an ephemeral fork without adding it to the thread list", async () => {
    const store = createChatStateStore();
    store.dispatch({
      type: "thread-list/applied",
      threads: [
        {
          id: "source",
          preview: "Source",
          name: null,
          archived: false,
          createdAt: 1,
          updatedAt: 1,
          provenance: { kind: "interactive" },
        },
      ],
    });
    const transport = transportMock();
    const lifecycle = createEphemeralThreadLifecycle({
      stateStore: store,
      transport,
      ensureConnected: vi.fn().mockResolvedValue(true),
      addSystemMessage: vi.fn(),
      notifyActiveThreadIdentityChanged: vi.fn(),
      interruptTurn: vi.fn().mockResolvedValue(true),
    });

    await expect(lifecycle.open({ sourceThreadId: "source", sourceThreadTitle: "Source" })).resolves.toBe(true);

    expect(transport.forkEphemeralThread).toHaveBeenCalledWith("source");
    expect(activeThreadState(store.getState())).toMatchObject({
      id: "side",
      lifetime: { kind: "ephemeral", sourceThreadId: "source", sourceThreadTitle: "Source" },
    });
    expect(store.getState().threadList.listedThreads.map((thread) => thread.id)).toEqual(["source"]);
  });

  it("unsubscribes an idle ephemeral thread before persistent navigation", async () => {
    const store = createChatStateStore();
    const transport = transportMock();
    const lifecycle = createEphemeralThreadLifecycle({
      stateStore: store,
      transport,
      ensureConnected: vi.fn().mockResolvedValue(true),
      addSystemMessage: vi.fn(),
      notifyActiveThreadIdentityChanged: vi.fn(),
      interruptTurn: vi.fn().mockResolvedValue(true),
    });
    await lifecycle.open({ sourceThreadId: "source", sourceThreadTitle: null });

    await expect(lifecycle.prepareForPersistentNavigation()).resolves.toBe(true);

    expect(transport.unsubscribeEphemeralThread).toHaveBeenCalledWith("side");
    expect(activeThreadId(store.getState())).toBeNull();
  });

  it("interrupts a running side turn before close cleanup", async () => {
    const store = createChatStateStore();
    const transport = transportMock();
    const interruptTurn = vi.fn().mockResolvedValue(true);
    const lifecycle = createEphemeralThreadLifecycle({
      stateStore: store,
      transport,
      ensureConnected: vi.fn().mockResolvedValue(true),
      addSystemMessage: vi.fn(),
      notifyActiveThreadIdentityChanged: vi.fn(),
      interruptTurn,
    });
    await lifecycle.open({ sourceThreadId: "source", sourceThreadTitle: null });
    store.dispatch({ type: "turn/started", threadId: "side", turnId: "turn" });

    await lifecycle.dispose();

    expect(interruptTurn).toHaveBeenCalledWith("side", "turn");
    expect(transport.unsubscribeEphemeralThread).toHaveBeenCalledWith("side");
  });

  it("unsubscribes a fork that resolves after the lifecycle is disposed without activating it", async () => {
    const store = createChatStateStore();
    let resolveFork!: (value: Awaited<ReturnType<EphemeralThreadTransport["forkEphemeralThread"]>>) => void;
    const transport = transportMock();
    transport.forkEphemeralThread = vi.fn(
      () =>
        new Promise<Awaited<ReturnType<EphemeralThreadTransport["forkEphemeralThread"]>>>((resolve) => {
          resolveFork = resolve;
        }),
    );
    const lifecycle = createEphemeralThreadLifecycle({
      stateStore: store,
      transport,
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
    expect(transport.unsubscribeEphemeralThread).toHaveBeenCalledWith("side");
    expect(activeThreadId(store.getState())).toBeNull();
  });

  it("still unsubscribes the side chat when interrupting its running turn fails", async () => {
    const store = createChatStateStore();
    const transport = transportMock();
    const lifecycle = createEphemeralThreadLifecycle({
      stateStore: store,
      transport,
      ensureConnected: vi.fn().mockResolvedValue(true),
      addSystemMessage: vi.fn(),
      notifyActiveThreadIdentityChanged: vi.fn(),
      interruptTurn: vi.fn().mockRejectedValue(new Error("interrupt failed")),
    });
    await lifecycle.open({ sourceThreadId: "source", sourceThreadTitle: null });
    store.dispatch({ type: "turn/started", threadId: "side", turnId: "turn" });

    await lifecycle.dispose();

    expect(transport.unsubscribeEphemeralThread).toHaveBeenCalledWith("side");
  });

  it("continues close cleanup when interrupting a running side turn does not settle", async () => {
    vi.useFakeTimers();
    try {
      const store = createChatStateStore();
      const transport = transportMock();
      const lifecycle = createEphemeralThreadLifecycle({
        stateStore: store,
        transport,
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

      expect(transport.unsubscribeEphemeralThread).toHaveBeenCalledWith("side");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the side chat active when unsubscribe fails before navigation", async () => {
    const store = createChatStateStore();
    const transport = transportMock();
    transport.unsubscribeEphemeralThread = vi.fn().mockResolvedValue(false);
    const addSystemMessage = vi.fn();
    const lifecycle = createEphemeralThreadLifecycle({
      stateStore: store,
      transport,
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
    const transport = transportMock();
    transport.forkEphemeralThread = vi.fn().mockResolvedValue({ kind: "cleanup-required", threadId: "side" });
    const addSystemMessage = vi.fn();
    const lifecycle = createEphemeralThreadLifecycle({
      stateStore: store,
      transport,
      ensureConnected: vi.fn().mockResolvedValue(true),
      addSystemMessage,
      notifyActiveThreadIdentityChanged: vi.fn(),
      interruptTurn: vi.fn().mockResolvedValue(true),
    });

    await expect(lifecycle.open({ sourceThreadId: "source", sourceThreadTitle: null })).resolves.toBe(false);
    await lifecycle.dispose();

    expect(addSystemMessage).toHaveBeenCalledWith("Could not prepare the side chat. Cleanup will be retried when this view closes.");
    expect(transport.unsubscribeEphemeralThread).toHaveBeenCalledWith("side");
  });
});

function transportMock(): EphemeralThreadTransport {
  return {
    forkEphemeralThread: vi.fn().mockResolvedValue({ kind: "ready", sourceThreadId: "source", activation: activationFixture() }),
    unsubscribeEphemeralThread: vi.fn().mockResolvedValue(true),
  };
}

function activationFixture(): ThreadActivationSnapshot {
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
    cwd: "/vault",
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
