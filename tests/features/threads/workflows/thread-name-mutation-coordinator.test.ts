import { describe, expect, it, vi } from "vitest";

import { createThreadNameMutationCoordinator } from "../../../../src/features/threads/workflows/thread-name-mutation-coordinator";
import { deferred } from "../../../support/async";

describe("ThreadNameMutationCoordinator", () => {
  it("does not let a failed mutation block the next mutation for the same thread", async () => {
    const coordinator = createThreadNameMutationCoordinator();
    const firstMutation = deferred<void>();
    const nextMutation = vi.fn().mockResolvedValue("saved");

    const failed = coordinator.run("thread", async () => {
      await firstMutation.promise;
      throw new Error("Save failed.");
    });
    const failure = expect(failed).rejects.toThrow("Save failed.");
    const next = coordinator.run("thread", nextMutation);

    expect(nextMutation).not.toHaveBeenCalled();
    firstMutation.resolve();

    await failure;
    await expect(next).resolves.toBe("saved");
    expect(nextMutation).toHaveBeenCalledOnce();
  });

  it("does not serialize mutations for different threads", async () => {
    const coordinator = createThreadNameMutationCoordinator();
    const firstMutation = deferred<void>();
    const blocked = coordinator.run("first", () => firstMutation.promise);

    await expect(coordinator.run("second", async () => "saved")).resolves.toBe("saved");

    firstMutation.resolve();
    await blocked;
  });
});
