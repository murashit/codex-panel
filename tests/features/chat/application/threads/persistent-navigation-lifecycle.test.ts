import { describe, expect, it, vi } from "vitest";

import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import type { EphemeralThreadLifecycle } from "../../../../../src/features/chat/application/threads/ephemeral-thread-lifecycle";
import {
  createPersistentNavigationLifecycle,
  type PersistentNavigationLifecycle,
} from "../../../../../src/features/chat/application/threads/persistent-navigation-lifecycle";

describe("persistent navigation lifecycle", () => {
  it("unsubscribes a running persistent subagent only after the target resume becomes active", async () => {
    const store = runningSubagentStore();
    const subscriptions = subscriptionPort();
    const ephemeral = ephemeralLifecycle();
    const lifecycle = createLifecycle({ stateStore: store, subscriptions, ephemeral });

    const preparation = await lifecycle.prepareForPersistentNavigation("other");

    expect(preparation).toEqual({ kind: "unsubscribe-on-adoption", threadId: "child" });
    expect(subscriptions.unsubscribeThread).not.toHaveBeenCalled();
    expect(ephemeral.prepareForPersistentNavigation).not.toHaveBeenCalled();
    expect(store.getState().panelThread).toMatchObject({ kind: "active", thread: { id: "child" } });
    resumeInteractiveThread(store, "other");

    if (!preparation) throw new Error("Expected navigation preparation.");
    lifecycle.commitPersistentNavigation(preparation);

    await vi.waitFor(() => expect(subscriptions.unsubscribeThread).toHaveBeenCalledWith("child"));
  });

  it("keeps the subagent subscribed until target adoption commits the preparation", async () => {
    const store = runningSubagentStore();
    const subscriptions = subscriptionPort();
    const lifecycle = createLifecycle({ stateStore: store, subscriptions });

    const preparation = await lifecycle.prepareForPersistentNavigation("other");
    if (!preparation) throw new Error("Expected navigation preparation.");
    expect(subscriptions.unsubscribeThread).not.toHaveBeenCalled();
    expect(store.getState().panelThread).toMatchObject({ kind: "active", thread: { id: "child" } });
  });

  it("defers running subagent cleanup until the blank target is adopted", async () => {
    const store = runningSubagentStore();
    const subscriptions = subscriptionPort(false);
    const lifecycle = createLifecycle({ stateStore: store, subscriptions });

    const preparation = await lifecycle.prepareForPersistentNavigation(null);

    expect(preparation).toEqual({ kind: "unsubscribe-on-adoption", threadId: "child" });
    expect(subscriptions.unsubscribeThread).not.toHaveBeenCalled();
    expect(store.getState().panelThread).toMatchObject({ kind: "active", thread: { id: "child" } });
  });

  it("retries a failed unsubscribe obligation on the next navigation", async () => {
    const store = runningSubagentStore();
    const subscriptions = subscriptionPort();
    vi.mocked(subscriptions.unsubscribeThread).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const addSystemMessage = vi.fn();
    const lifecycle = createLifecycle({ stateStore: store, subscriptions, addSystemMessage });
    const preparation = await lifecycle.prepareForPersistentNavigation("other");
    if (!preparation) throw new Error("Expected navigation preparation.");

    lifecycle.commitPersistentNavigation(preparation);

    await vi.waitFor(() => expect(subscriptions.unsubscribeThread).toHaveBeenCalledOnce());
    expect(addSystemMessage).toHaveBeenCalledWith("Could not unsubscribe from the previous subagent.");
    await Promise.resolve();

    await lifecycle.prepareForPersistentNavigation("other");

    await vi.waitFor(() => expect(subscriptions.unsubscribeThread).toHaveBeenCalledTimes(2));
  });

  it("does not unsubscribe when the target is the already active subagent", async () => {
    const subscriptions = subscriptionPort();
    const lifecycle = createLifecycle({ stateStore: runningSubagentStore(), subscriptions });

    await expect(lifecycle.prepareForPersistentNavigation("child")).resolves.toEqual({ kind: "ready" });

    expect(subscriptions.unsubscribeThread).not.toHaveBeenCalled();
  });
});

function runningSubagentStore() {
  const store = createChatStateStore();
  store.dispatch({
    type: "active-thread/resumed",
    approvalPolicyKnown: true,
    sandboxPolicyKnown: true,
    permissionProfileKnown: true,
    approvalPolicy: null,
    sandboxPolicy: null,
    activePermissionProfile: null,
    thread: {
      id: "child",
      cliVersion: "test",
      provenance: {
        kind: "subagent",
        subagentKind: "thread-spawn",
        parentThreadId: "parent",
        sessionId: "session",
        depth: 1,
        agentNickname: "Scout",
        agentRole: "explorer",
      },
    } as never,
    model: null,
    reasoningEffort: null,
    serviceTier: null,
    approvalsReviewer: null,
  });
  store.dispatch({ type: "turn/started", threadId: "child", turnId: "turn" });
  return store;
}

function resumeInteractiveThread(store: ReturnType<typeof createChatStateStore>, threadId: string): void {
  store.dispatch({
    type: "active-thread/resumed",
    approvalPolicyKnown: true,
    sandboxPolicyKnown: true,
    permissionProfileKnown: true,
    approvalPolicy: null,
    sandboxPolicy: null,
    activePermissionProfile: null,
    thread: { id: threadId, cliVersion: "test", provenance: { kind: "interactive" } } as never,
    model: null,
    reasoningEffort: null,
    serviceTier: null,
    approvalsReviewer: null,
  });
}

function createLifecycle(options: {
  stateStore: ReturnType<typeof createChatStateStore>;
  subscriptions: ReturnType<typeof subscriptionPort>;
  ephemeral?: EphemeralThreadLifecycle;
  addSystemMessage?: (text: string) => void;
}): PersistentNavigationLifecycle {
  return createPersistentNavigationLifecycle({
    stateStore: options.stateStore,
    unsubscribeThread: options.subscriptions.unsubscribeThread,
    ephemeral: options.ephemeral ?? ephemeralLifecycle(),
    addSystemMessage: options.addSystemMessage ?? vi.fn(),
  });
}

function subscriptionPort(result = true) {
  return { unsubscribeThread: vi.fn().mockResolvedValue(result) };
}

function ephemeralLifecycle(): EphemeralThreadLifecycle {
  return {
    open: vi.fn(),
    prepareForPersistentNavigation: vi.fn().mockResolvedValue(true),
    dispose: vi.fn().mockResolvedValue(undefined),
  };
}
