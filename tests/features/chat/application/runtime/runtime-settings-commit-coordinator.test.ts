import { describe, expect, it, vi } from "vitest";

import type { RuntimeSettingsPatch } from "../../../../../src/domain/runtime/thread-settings";
import { createRuntimeSettingsCommitCoordinator } from "../../../../../src/features/chat/application/runtime/runtime-settings-commit-coordinator";
import { deferred } from "../../../../support/async";

describe("createRuntimeSettingsCommitCoordinator", () => {
  it("serializes one thread's commits across an A to B to A panel revision", async () => {
    let currentRevision = 1;
    let pending: RuntimeSettingsPatch = { model: "old" };
    const firstUpdate = deferred<boolean>();
    const updateThreadSettings = vi.fn().mockReturnValueOnce(firstUpdate.promise).mockResolvedValueOnce(true);
    const coordinator = createRuntimeSettingsCommitCoordinator({
      scopeIsCurrent: (scope) => scope.panelTargetRevision === currentRevision,
      pendingPatch: () => pending,
      updateThreadSettings,
      commitPatch: () => {
        pending = {};
      },
      reportError: vi.fn(),
    });

    const oldCommit = coordinator.commit({ threadId: "thread-a", panelTargetRevision: 1 }, { kind: "fields", update: { model: "old" } });
    await vi.waitFor(() => expect(updateThreadSettings).toHaveBeenCalledOnce());
    currentRevision = 3;
    pending = { model: "latest" };
    const latestCommit = coordinator.commit(
      { threadId: "thread-a", panelTargetRevision: 3 },
      { kind: "fields", update: { model: "latest" } },
    );
    await Promise.resolve();
    expect(updateThreadSettings).toHaveBeenCalledOnce();

    firstUpdate.resolve(true);
    await expect(oldCommit).resolves.toBe(false);
    await vi.waitFor(() => expect(updateThreadSettings).toHaveBeenCalledTimes(2));
    await expect(latestCommit).resolves.toBe(true);
    expect(updateThreadSettings).toHaveBeenNthCalledWith(2, "thread-a", { model: "latest" });
  });
});
