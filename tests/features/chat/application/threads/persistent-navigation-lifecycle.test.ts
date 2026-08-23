import { describe, expect, it, vi } from "vitest";

import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import type { EphemeralThreadLifecycle } from "../../../../../src/features/chat/application/threads/ephemeral-thread-lifecycle";
import {
  createPersistentNavigationLifecycle,
  type PersistentNavigationLifecycle,
} from "../../../../../src/features/chat/application/threads/persistent-navigation-lifecycle";
import { deferred } from "../../../../support/async";

describe("persistent navigation lifecycle", () => {
  it("unsubscribes a persistent subagent only after navigation adoption", async () => {
    const store = subagentStore(true);
    const subscriptions = subscriptionPort();
    const ephemeral = ephemeralLifecycle();
    const lifecycle = createLifecycle({ stateStore: store, subscriptions, ephemeral });

    const preparation = await lifecycle.prepareForPersistentNavigation("other");

    expect(preparation).toEqual({ kind: "unsubscribe-on-adoption", threadId: "child" });
    expect(subscriptions.unsubscribeThread).not.toHaveBeenCalled();
    expect(ephemeral.prepareForPersistentNavigation).not.toHaveBeenCalled();
    resumeInteractiveThread(store, "other");

    if (!preparation) throw new Error("Expected navigation preparation.");
    lifecycle.commitPersistentNavigation(preparation);

    await vi.waitFor(() => expect(subscriptions.unsubscribeThread).toHaveBeenCalledWith("child"));
  });

  it("also cleans an idle subagent after navigation adoption", async () => {
    const subscriptions = subscriptionPort();
    const lifecycle = createLifecycle({ stateStore: subagentStore(false), subscriptions });

    const preparation = await lifecycle.prepareForPersistentNavigation("other");
    expect(preparation).toEqual({ kind: "unsubscribe-on-adoption", threadId: "child" });
    expect(subscriptions.unsubscribeThread).not.toHaveBeenCalled();

    if (!preparation) throw new Error("Expected navigation preparation.");
    lifecycle.commitPersistentNavigation(preparation);

    await vi.waitFor(() => expect(subscriptions.unsubscribeThread).toHaveBeenCalledWith("child"));
  });

  it("keeps the target subagent subscribed", async () => {
    const subscriptions = subscriptionPort();
    const lifecycle = createLifecycle({ stateStore: subagentStore(true), subscriptions });

    await expect(lifecycle.prepareForPersistentNavigation("child")).resolves.toEqual({ kind: "ready" });

    expect(subscriptions.unsubscribeThread).not.toHaveBeenCalled();
  });

  it("rejects reselecting a subagent while its unsubscribe is pending", async () => {
    const unsubscribe = deferred<boolean>();
    const subscriptions = subscriptionPort();
    subscriptions.unsubscribeThread.mockReturnValue(unsubscribe.promise);
    const store = subagentStore(false);
    const lifecycle = createLifecycle({ stateStore: store, subscriptions });
    const preparation = await lifecycle.prepareForPersistentNavigation("other");
    if (!preparation) throw new Error("Expected navigation preparation.");
    resumeInteractiveThread(store, "other");
    lifecycle.commitPersistentNavigation(preparation);

    await vi.waitFor(() => expect(subscriptions.unsubscribeThread).toHaveBeenCalledWith("child"));
    await expect(lifecycle.prepareForPersistentNavigation("child")).resolves.toBeNull();

    unsubscribe.resolve(true);
  });

  it("retries a failed unsubscribe obligation on the next navigation", async () => {
    const subscriptions = subscriptionPort();
    vi.mocked(subscriptions.unsubscribeThread).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const addSystemMessage = vi.fn();
    const lifecycle = createLifecycle({ stateStore: subagentStore(true), subscriptions, addSystemMessage });
    const preparation = await lifecycle.prepareForPersistentNavigation("other");
    if (!preparation) throw new Error("Expected navigation preparation.");

    lifecycle.commitPersistentNavigation(preparation);

    await vi.waitFor(() => expect(subscriptions.unsubscribeThread).toHaveBeenCalledOnce());
    expect(addSystemMessage).toHaveBeenCalledWith("Could not unsubscribe from the previous subagent.");
    await Promise.resolve();

    await lifecycle.prepareForPersistentNavigation("other");

    await vi.waitFor(() => expect(subscriptions.unsubscribeThread).toHaveBeenCalledTimes(2));
  });
});

function subagentStore(busy: boolean) {
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
  if (busy) store.dispatch({ type: "turn/started", threadId: "child", turnId: "turn" });
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
    cleanupForConnectionReset: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
  };
}
