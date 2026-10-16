import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { AppServerClient } from "../../../../../src/app-server/connection/client";
import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { createSessionThreadReadState } from "../../../../../src/features/chat/host/session/thread-read-state";
import { deferred } from "../../../../support/async";
import { chatStateFixture } from "../../support/state";

function flush(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function receipt(revision: string, unread = true) {
  return { revision, firstUnread: unread ? { type: "turn" as const, turnId: "turn" } : null };
}

async function fixture() {
  const stateStore = createChatStateStore(chatStateFixture({ activeThread: { id: "thread" } }));
  const request = vi.fn().mockResolvedValue({ readState: null });
  const client = { request } as unknown as AppServerClient;
  let currentClient: AppServerClient | null = client;
  let foreground = false;
  const owner = createSessionThreadReadState({ stateStore, currentClient: () => currentClient, isForeground: () => foreground });
  onTestFinished(owner.dispose);
  await flush();
  return {
    stateStore,
    request,
    client,
    owner,
    setForeground: () => {
      foreground = true;
      owner.activate();
    },
    setClient: (next: AppServerClient | null) => {
      currentClient = next;
      stateStore.dispatch({ type: "connection/status-set", statusText: next ? "connected" : "disconnected" });
    },
    notify: (revision: string, unread = true) => owner.receive({ threadId: "thread", readState: receipt(revision, unread) }),
  };
}

describe("session thread read state", () => {
  it("acknowledges incoming foreground receipts without resolving pending input", async () => {
    const f = await fixture();
    f.setForeground();
    f.stateStore.dispatch({
      type: "request/user-input-queued",
      input: {
        requestId: 1,
        params: { turnId: "turn", questions: [], isBlocking: true },
        autoResolutionAtMs: null,
      },
    });
    const requests = f.stateStore.getState().requests;
    f.request.mockResolvedValue({ readState: receipt("read", false) });
    f.notify("new");
    await flush();
    expect(f.request).toHaveBeenLastCalledWith("thread/readState/update", expect.objectContaining({ expectedRevision: "new" }));
    expect(f.stateStore.getState().requests).toBe(requests);
  });

  it("does not overwrite notifications with a late metadata read or acknowledgement", async () => {
    const f = await fixture();
    const refresh = deferred<unknown>();
    f.setClient(null);
    f.request.mockReturnValueOnce(refresh.promise);
    f.setClient(f.client);
    f.notify("newer");
    refresh.resolve({ readState: receipt("old", false) });
    await flush();
    expect(f.stateStore.getState().threadReadReceipt?.revision).toBe("newer");
    const ack = deferred<unknown>();
    f.request.mockReturnValueOnce(ack.promise);
    f.setForeground();
    f.owner.activate();
    expect(f.request).toHaveBeenCalledTimes(3);
    f.notify("newest", false);
    ack.resolve({ readState: receipt("old-ack", false) });
    await flush();
    expect(f.stateStore.getState().threadReadReceipt?.revision).toBe("newest");
  });

  it("refreshes after a conflict without retrying its fresh unread revision", async () => {
    const f = await fixture();
    f.notify("r1");
    f.request.mockRejectedValueOnce(new Error("read state changed")).mockResolvedValue({ readState: receipt("r2") });
    f.setForeground();
    await flush();
    expect(f.request.mock.calls.map(([method]) => method)).toEqual(["thread/read", "thread/readState/update", "thread/read"]);
    expect(f.stateStore.getState().threadReadReceipt).toEqual({ revision: "r2", unread: true });
    f.request.mockResolvedValue({ readState: receipt("r3", false) });
    f.owner.activate();
    await flush();
    expect(f.request).toHaveBeenLastCalledWith("thread/readState/update", expect.objectContaining({ expectedRevision: "r2" }));
  });

  it("refreshes on reconnect and rejects responses from a retired connection scope", async () => {
    const f = await fixture();
    f.notify("r1");
    const old = deferred<unknown>();
    f.request.mockReturnValueOnce(old.promise);
    f.setForeground();
    f.setClient(null);
    f.request.mockResolvedValue({ readState: receipt("r2") });
    f.setClient(f.client);
    await flush();
    // The new scope refreshed and acknowledged r2, even though an old ACK was outstanding.
    expect(f.request).toHaveBeenLastCalledWith("thread/readState/update", expect.objectContaining({ expectedRevision: "r2" }));
    old.resolve({ readState: receipt("old", false) });
    await flush();
    expect(f.stateStore.getState().threadReadReceipt?.revision).toBe("r2");
  });

  it.each(["target", "dispose"] as const)("ignores delayed responses after %s changes", async (change) => {
    const f = await fixture();
    f.notify("r1");
    const ack = deferred<unknown>();
    f.request.mockReturnValueOnce(ack.promise);
    f.setForeground();
    if (change === "target") f.stateStore.dispatch({ type: "active-thread/cleared" });
    else f.owner.dispose();
    ack.resolve({ readState: receipt("late", false) });
    await flush();
    expect(f.stateStore.getState().threadReadReceipt?.revision).not.toBe("late");
  });
});
