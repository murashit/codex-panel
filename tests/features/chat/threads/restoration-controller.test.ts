// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { createChatState, createChatStateStore } from "../../../../src/features/chat/application/state/reducer";
import { RestorationController } from "../../../../src/features/chat/application/threads/restoration-controller";
import { createChatViewDeferredTasks } from "../../../../src/features/chat/host/lifecycle";
import { deferred } from "../../../support/async";

describe("RestorationController", () => {
  it("restores a placeholder and schedules deferred hydration", () => {
    vi.useFakeTimers();
    const stateStore = createChatStateStore(createChatState());
    const resumeThread = vi.fn().mockResolvedValue(undefined);
    const controller = new RestorationController({
      deferredTasks: createChatViewDeferredTasks(() => window),
      opened: () => true,
      resumeThread,
      invalidateResumeWork: vi.fn(),
      stateStore,
      setStatus: vi.fn(),
      refreshTabHeader: vi.fn(),
    });

    controller.restore({ threadId: "thread", title: "Title", explicitName: null });

    expect(controller.placeholder()).toMatchObject({ threadId: "thread", title: "Title" });
    expect(stateStore.getState().activeThread.id).toBe("thread");
    vi.advanceTimersByTime(1_500);
    expect(resumeThread).toHaveBeenCalledWith("thread");
    vi.useRealTimers();
  });

  it("shares an in-flight restore load", async () => {
    const resume = deferred<undefined>();
    const controller = restoredThreadControllerFixture({ resumeThread: vi.fn(() => resume.promise) });
    controller.restore({ threadId: "thread", title: null, explicitName: null });

    const first = controller.ensureLoaded();
    const second = controller.ensureLoaded();
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
    deferredTasks: createChatViewDeferredTasks(() => window),
    opened: () => false,
    resumeThread: vi.fn().mockResolvedValue(undefined),
    invalidateResumeWork: vi.fn(),
    stateStore: createChatStateStore(createChatState()),
    setStatus: vi.fn(),
    refreshTabHeader: vi.fn(),
    ...overrides,
  });
}
