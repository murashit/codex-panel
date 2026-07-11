import { describe, expect, it, vi } from "vitest";

import type { ThreadActivationSnapshot } from "../../../../../src/domain/threads/activation";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { createEphemeralThreadLifecycle } from "../../../../../src/features/chat/application/threads/ephemeral-thread-lifecycle";
import type { EphemeralThreadTransport } from "../../../../../src/features/chat/application/threads/ephemeral-thread-transport";

describe("ephemeral thread lifecycle", () => {
  it("activates an ephemeral fork without adding it to the thread list", async () => {
    const store = createChatStateStore();
    store.dispatch({
      type: "thread-list/applied",
      threads: [{ id: "source", preview: "Source", name: null, archived: false, createdAt: 1, updatedAt: 1 }],
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
    expect(store.getState().activeThread).toMatchObject({
      id: "side",
      lifetime: { kind: "ephemeral", sourceThreadId: "source", sourceThreadTitle: "Source" },
    });
    expect(store.getState().threadList.listedThreads.map((thread) => thread.id)).toEqual(["source"]);
  });

  it("deletes an idle ephemeral thread before persistent navigation", async () => {
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

    expect(transport.deleteEphemeralThread).toHaveBeenCalledWith("side");
    expect(store.getState().activeThread.id).toBeNull();
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
    expect(transport.deleteEphemeralThread).toHaveBeenCalledWith("side");
  });

  it("deletes a fork that resolves after the lifecycle is disposed without activating it", async () => {
    const store = createChatStateStore();
    let resolveFork!: (value: Awaited<ReturnType<EphemeralThreadTransport["forkEphemeralThread"]>>) => void;
    const transport = transportMock();
    transport.forkEphemeralThread = vi.fn(
      () =>
        new Promise<{ activation: ThreadActivationSnapshot; sourceThreadId: string } | null>((resolve) => {
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
    resolveFork({ sourceThreadId: "source", activation: activationFixture() });

    await expect(opening).resolves.toBe(false);
    expect(transport.deleteEphemeralThread).toHaveBeenCalledWith("side");
    expect(store.getState().activeThread.id).toBeNull();
  });

  it("still deletes the side chat when interrupting its running turn fails", async () => {
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

    expect(transport.deleteEphemeralThread).toHaveBeenCalledWith("side");
  });

  it("keeps the side chat active when deletion fails before navigation", async () => {
    const store = createChatStateStore();
    const transport = transportMock();
    transport.deleteEphemeralThread = vi.fn().mockResolvedValue(false);
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

    expect(store.getState().activeThread.id).toBe("side");
    expect(addSystemMessage).toHaveBeenCalledWith("Could not discard the side chat. Try again before switching threads.");
  });
});

function transportMock(): EphemeralThreadTransport {
  return {
    forkEphemeralThread: vi.fn().mockResolvedValue({ sourceThreadId: "source", activation: activationFixture() }),
    deleteEphemeralThread: vi.fn().mockResolvedValue(true),
  };
}

function activationFixture(): ThreadActivationSnapshot {
  return {
    thread: { id: "side", preview: "", name: null, archived: false, createdAt: 1, updatedAt: 1 },
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
