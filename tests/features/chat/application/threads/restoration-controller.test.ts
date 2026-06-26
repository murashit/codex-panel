// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { RestorationController } from "../../../../../src/features/chat/application/threads/restoration-controller";
import { deferred } from "../../../../support/async";

describe("RestorationController", () => {
  it("restores a placeholder for explicit hydration", async () => {
    const resumeThread = vi.fn().mockResolvedValue(undefined);
    const controller = restoredThreadControllerFixture();

    controller.restore({ threadId: "thread", title: "Title", explicitName: null });

    expect(controller.placeholder()).toMatchObject({ threadId: "thread", title: "Title" });
    expect(resumeThread).not.toHaveBeenCalled();

    await controller.ensureLoaded(resumeThread);

    expect(resumeThread).toHaveBeenCalledWith("thread");
  });

  it("shares an in-flight restore load", async () => {
    const resume = deferred<undefined>();
    const loadThread = vi.fn(() => resume.promise);
    const controller = restoredThreadControllerFixture();
    controller.restore({ threadId: "thread", title: null, explicitName: null });

    const first = controller.ensureLoaded(loadThread);
    const second = controller.ensureLoaded(loadThread);
    await Promise.resolve();
    expect(controller.placeholder()?.loading).toBe(resume.promise);

    resume.resolve(undefined);
    await Promise.all([first, second]);

    expect(controller.placeholder()?.loading).toBeNull();
  });

  it("updates placeholder rename state without touching other threads", () => {
    const controller = restoredThreadControllerFixture();
    controller.restore({ threadId: "thread", title: "Old", explicitName: null });

    expect(controller.rename("other", "Other")).toBe(false);
    expect(controller.rename("thread", "New")).toBe(true);
    expect(controller.placeholder()).toMatchObject({ title: "New", explicitName: "New" });
  });
});

function restoredThreadControllerFixture(overrides: Partial<ConstructorParameters<typeof RestorationController>[0]> = {}) {
  return new RestorationController({
    invalidateThreadWork: vi.fn(),
    setStatus: vi.fn(),
    refreshTabHeader: vi.fn(),
    ...overrides,
  });
}
