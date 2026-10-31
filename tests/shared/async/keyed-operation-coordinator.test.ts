import { describe, expect, it, vi } from "vitest";

import { createKeyedOperationCoordinator } from "../../../src/shared/async/keyed-operation-coordinator";
import { deferred, waitForAsyncWork } from "../../support/async";

describe("KeyedOperationCoordinator", () => {
  it("keeps queued operations in FIFO order when another arrives during the second operation", async () => {
    const coordinator = createKeyedOperationCoordinator<string>({ whenBusy: "queue" });
    const firstRelease = deferred<void>();
    const secondRelease = deferred<void>();
    const events: string[] = [];

    const first = coordinator.run("key", async () => {
      events.push("first:start");
      await firstRelease.promise;
      events.push("first:end");
    });
    const second = coordinator.run("key", async () => {
      events.push("second:start");
      await secondRelease.promise;
      events.push("second:end");
    });

    await waitForAsyncWork(() => expect(events).toEqual(["first:start"]));
    firstRelease.resolve();
    await first;
    await waitForAsyncWork(() => expect(events).toEqual(["first:start", "first:end", "second:start"]));
    const third = coordinator.run("key", async () => {
      events.push("third");
    });
    await Promise.resolve();
    expect(events).toEqual(["first:start", "first:end", "second:start"]);

    secondRelease.resolve();
    await Promise.all([second, third]);

    expect(events).toEqual(["first:start", "first:end", "second:start", "second:end", "third"]);
  });

  it("does not let a failed operation block the next operation for the same key", async () => {
    const coordinator = createKeyedOperationCoordinator<string>({ whenBusy: "queue" });
    const firstOperation = deferred<void>();
    const nextOperation = vi.fn().mockResolvedValue("saved");

    const failed = coordinator.run("key", async () => {
      await firstOperation.promise;
      throw new Error("Save failed.");
    });
    const next = coordinator.run("key", nextOperation);

    expect(nextOperation).not.toHaveBeenCalled();
    firstOperation.resolve();

    await expect(failed).rejects.toThrow("Save failed.");
    await expect(next).resolves.toBe("saved");
    expect(nextOperation).toHaveBeenCalledOnce();
  });

  it("rejects another operation for the same key under the reject policy", async () => {
    const coordinator = createKeyedOperationCoordinator<string>({ whenBusy: "reject" });
    const pending = deferred<void>();

    const first = coordinator.run("thread", () => pending.promise);

    await expect(coordinator.run("thread", async () => undefined)).rejects.toThrow("An operation is already in progress.");
    pending.resolve();
    await first;

    await expect(coordinator.run("thread", async () => "next")).resolves.toBe("next");
  });

  it.each(["queue", "reject"] as const)("keeps %s-policy operations for different keys independent", async (whenBusy) => {
    const coordinator = createKeyedOperationCoordinator<string>({ whenBusy });
    const pending = deferred<void>();

    const first = coordinator.run("first", () => pending.promise);

    await expect(coordinator.run("second", async () => "second")).resolves.toBe("second");
    pending.resolve();
    await first;
  });
});
