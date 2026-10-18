import { describe, expect, it, vi } from "vitest";
import type { AppServerClient } from "../../../src/app-server/connection/client";
import { ThreadSubscriptions } from "../../../src/app-server/connection/thread-subscriptions";
import { deferred, waitForAsyncWork } from "../../support/async";

describe("shared presentation subscriptions", () => {
  it("waits for the same thread while unrelated activations, restores and releases proceed", async () => {
    const restored = deferred<unknown>();
    const request = vi.fn((_method: string, params: { threadId: string }) =>
      params.threadId === "A" ? restored.promise : Promise.resolve({}),
    );
    const fixture = subscriptionFixture(request);
    fixture.required.set("A", true);
    fixture.subscriptions.reconcile();
    const activateA = vi.fn(async () => undefined);
    const openingA = fixture.subscriptions.activate("A", activateA);
    fixture.required.set("child-B", true);
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
      fixture.required.set("child", true);
      fixture.subscriptions.reconcile();
      expect(request).toHaveBeenCalledExactlyOnceWith("thread/resume", { threadId: "child", excludeTurns: true });
      if (fails) {
        created.reject(new Error("creation failed"));
        await expect(creating).rejects.toThrow("creation failed");
      } else {
        fixture.required.set("created", true);
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
    fixture.required.set("child", true);
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
    fixture.required.set("child", true);
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

  it.each([true, false])("ignores old release completion after connection replacement (resumable=%s)", async (canResume) => {
    const released = deferred<unknown>();
    const oldRequest = vi.fn(() => released.promise);
    const fixture = subscriptionFixture(oldRequest);
    if (canResume) fixture.subscriptions.record("thread", fixture.client);
    else {
      fixture.required.set("thread", false);
      fixture.subscriptions.reconcile();
      fixture.required.clear();
    }
    fixture.subscriptions.reconcile();
    const staleOperation = vi.fn(async () => undefined);
    const staleActivation = fixture.subscriptions.activate("thread", staleOperation);
    fixture.subscriptions.reset();
    const nextRequest = vi.fn().mockResolvedValue({ status: "unsubscribed" });
    const nextClient = { request: nextRequest } as unknown as AppServerClient;
    fixture.replaceClient(nextClient);
    fixture.subscriptions.record("ignored-old-client", fixture.client);
    if (canResume) fixture.subscriptions.record("thread", nextClient);
    fixture.required.set("thread", canResume);
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
  it("keeps upstream release responsibility distinct from acknowledged acquisition", async () => {
    const request = vi.fn().mockResolvedValue({ status: "notSubscribed" });
    const fixture = subscriptionFixture(request);
    fixture.required.set("child", false);
    fixture.subscriptions.reconcile();
    fixture.subscriptions.reconcile();
    expect(request).not.toHaveBeenCalled();
    // An unrelated/retired client's reply cannot acknowledge this connection's interest.
    fixture.subscriptions.record("child", {} as AppServerClient);
    fixture.required.set("child", true);
    fixture.subscriptions.reconcile();
    await waitForAsyncWork(() =>
      expect(request).toHaveBeenCalledExactlyOnceWith("thread/resume", { threadId: "child", excludeTurns: true }),
    );
    fixture.required.clear();
    fixture.subscriptions.reconcile();
    await waitForAsyncWork(() => expect(request).toHaveBeenCalledTimes(2));
    // A later upstream presentation is tracked afresh without attempting unsupported resume.
    fixture.required.set("child", false);
    fixture.subscriptions.reconcile();
    fixture.subscriptions.reconcile();
    await fixture.subscriptions.activate("child", async () => undefined);
    fixture.required.clear();
    fixture.subscriptions.reconcile();
    await waitForAsyncWork(() => expect(request).toHaveBeenCalledTimes(3));
    expect(request.mock.calls.map(([method]) => method)).toEqual(["thread/resume", "thread/unsubscribe", "thread/unsubscribe"]);
    expect(fixture.failure).not.toHaveBeenCalled();
  });
});

function subscriptionFixture(request: ReturnType<typeof vi.fn>) {
  let client = { request } as unknown as AppServerClient;
  const required = new Map<string, boolean>();
  const failure = vi.fn();
  const subscriptions = new ThreadSubscriptions(
    () => client,
    () => [...required].map(([threadId, canResume]) => ({ threadId, canResume })),
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
