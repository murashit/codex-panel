import { describe, expect, it, vi } from "vitest";
import type { AppServerClient } from "../../../src/app-server/connection/client";
import { ThreadSubscriptions } from "../../../src/app-server/connection/thread-subscriptions";
import { deferred, waitForAsyncWork } from "../../support/async";

describe("persistent subscription recovery", () => {
  it("waits for the same thread while unrelated activations, restores and releases proceed", async () => {
    const restored = deferred<unknown>();
    const request = vi.fn((_method: string, params: { threadId: string }) =>
      params.threadId === "A" ? restored.promise : Promise.resolve({}),
    );
    const fixture = subscriptionFixture(request);
    fixture.required.add("A");
    fixture.subscriptions.reconcile();
    const activateA = vi.fn(async () => undefined);
    const openingA = fixture.subscriptions.activate("A", activateA);
    fixture.required.add("child-B");
    fixture.subscriptions.record("unneeded", fixture.client);
    fixture.subscriptions.reconcile();
    const activateB = vi.fn(async () => undefined);
    await fixture.subscriptions.activate("B", activateB);
    expect(activateA).not.toHaveBeenCalled();
    expect(activateB).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith("thread/resume", { threadId: "child-B", excludeTurns: true });
    expect(request).toHaveBeenCalledWith("thread/unsubscribe", { threadId: "unneeded" }, expect.anything());
    restored.resolve({});
    await openingA;
    expect(activateA).toHaveBeenCalledOnce();
  });

  it.each([false, true])(
    "protects early creation attachments while other children restore, then releases the scope (failure: %s)",
    async (fails) => {
      const created = deferred<void>();
      const request = vi.fn().mockResolvedValue({});
      const fixture = subscriptionFixture(request);
      const creating = fixture.subscriptions.activate(null, () => created.promise);
      fixture.subscriptions.record("created", fixture.client);
      fixture.required.add("child");
      fixture.subscriptions.reconcile();
      expect(request).toHaveBeenCalledExactlyOnceWith("thread/resume", { threadId: "child", excludeTurns: true });
      if (fails) {
        created.reject(new Error("creation failed"));
        await expect(creating).rejects.toThrow("creation failed");
      } else {
        fixture.required.add("created");
        created.resolve();
        await creating;
        expect(request).not.toHaveBeenCalledWith("thread/unsubscribe", { threadId: "created" }, expect.anything());
        fixture.required.delete("created");
        fixture.subscriptions.reconcile();
      }
      await waitForAsyncWork(() => expect(request).toHaveBeenCalledWith("thread/unsubscribe", { threadId: "created" }, expect.anything()));
    },
  );

  it("releases a recovered child again if its parent stops needing it during recovery", async () => {
    const released = deferred<unknown>();
    const resumed = deferred<unknown>();
    const request = vi.fn((method: string) => (method === "thread/resume" ? resumed.promise : released.promise));
    const fixture = subscriptionFixture(request);
    fixture.subscriptions.record("child", fixture.client);
    fixture.subscriptions.reconcile();
    fixture.required.add("child");
    fixture.subscriptions.reconcile();
    released.resolve({ status: "unsubscribed" });
    await waitForAsyncWork(() => expect(request).toHaveBeenCalledWith("thread/resume", { threadId: "child", excludeTurns: true }));
    fixture.required.clear();
    fixture.subscriptions.reconcile();
    resumed.resolve({});
    await waitForAsyncWork(() => expect(request.mock.calls.filter(([method]) => method === "thread/unsubscribe")).toHaveLength(2));
    expect(fixture.failure).not.toHaveBeenCalled();
  });

  it.each([false, true])("restores a released child's delivery and later releases it again (recovery fails: %s)", async (failRecovery) => {
    const request = vi.fn().mockResolvedValue({ status: "unsubscribed" });
    const fixture = subscriptionFixture(request);
    fixture.subscriptions.record("child", fixture.client);
    fixture.subscriptions.reconcile();
    await waitForAsyncWork(() => expect(request).toHaveBeenCalledOnce());
    fixture.required.add("child");
    if (failRecovery) request.mockRejectedValueOnce(new Error("connection unavailable"));
    fixture.subscriptions.reconcile();
    if (failRecovery) {
      await waitForAsyncWork(() =>
        expect(fixture.failure).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("connection unavailable")),
      );
      fixture.subscriptions.reconcile();
    }
    await waitForAsyncWork(() => expect(request).toHaveBeenCalledTimes(failRecovery ? 3 : 2));
    expect(request.mock.calls.at(-1)).toEqual(["thread/resume", { threadId: "child", excludeTurns: true }]);
    fixture.required.clear();
    fixture.subscriptions.reconcile();
    await waitForAsyncWork(() => expect(request.mock.calls.filter(([method]) => method === "thread/unsubscribe")).toHaveLength(2));
  });

  it("ignores old release completion after the connection has been replaced", async () => {
    const released = deferred<unknown>();
    const oldRequest = vi.fn(() => released.promise);
    const fixture = subscriptionFixture(oldRequest);
    fixture.subscriptions.record("thread", fixture.client);
    fixture.subscriptions.reconcile();
    const staleOperation = vi.fn(async () => undefined);
    const staleActivation = fixture.subscriptions.activate("thread", staleOperation);
    fixture.subscriptions.reset();
    const nextRequest = vi.fn().mockResolvedValue({ status: "unsubscribed" });
    const nextClient = { request: nextRequest } as unknown as AppServerClient;
    fixture.replaceClient(nextClient);
    fixture.subscriptions.record("thread", nextClient);
    fixture.required.add("thread");
    fixture.subscriptions.reconcile();
    released.resolve({ status: "unsubscribed" });
    await expect(staleActivation).rejects.toThrow("Stale Codex app-server connection");
    expect(staleOperation).not.toHaveBeenCalled();
    await fixture.subscriptions.activate("thread", async () => undefined);
    fixture.required.clear();
    fixture.subscriptions.reconcile();
    await waitForAsyncWork(() => expect(nextRequest).toHaveBeenCalledOnce());
    expect(nextRequest).toHaveBeenCalledWith("thread/unsubscribe", { threadId: "thread" }, expect.anything());
    expect(oldRequest).toHaveBeenCalledOnce();
    expect(fixture.failure).not.toHaveBeenCalled();
  });
});

function subscriptionFixture(request: ReturnType<typeof vi.fn>) {
  let client = { request } as unknown as AppServerClient;
  const required = new Set<string>();
  const failure = vi.fn();
  const subscriptions = new ThreadSubscriptions(
    () => client,
    () => required,
    failure,
  );
  return {
    subscriptions,
    client,
    required,
    failure,
    replaceClient: (next: AppServerClient) => {
      client = next;
    },
  };
}
