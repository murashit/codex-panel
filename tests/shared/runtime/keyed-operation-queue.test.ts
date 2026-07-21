import { describe, expect, it, vi } from "vitest";

import { createKeyedOperationQueue } from "../../../src/shared/runtime/keyed-operation-queue";
import { deferred } from "../../support/async";

describe("KeyedOperationQueue", () => {
  it("does not let a failed operation block the next operation for the same key", async () => {
    const queue = createKeyedOperationQueue<string>();
    const firstOperation = deferred<void>();
    const nextOperation = vi.fn().mockResolvedValue("saved");

    const failed = queue.run("key", async () => {
      await firstOperation.promise;
      throw new Error("Save failed.");
    });
    const failure = expect(failed).rejects.toThrow("Save failed.");
    const next = queue.run("key", nextOperation);

    expect(nextOperation).not.toHaveBeenCalled();
    firstOperation.resolve();

    await failure;
    await expect(next).resolves.toBe("saved");
    expect(nextOperation).toHaveBeenCalledOnce();
  });

  it("does not serialize operations for different keys", async () => {
    const queue = createKeyedOperationQueue<string>();
    const firstOperation = deferred<void>();
    const blocked = queue.run("first", () => firstOperation.promise);

    await expect(queue.run("second", async () => "saved")).resolves.toBe("saved");

    firstOperation.resolve();
    await blocked;
  });
});
