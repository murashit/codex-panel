import { describe, expect, it, vi } from "vitest";

import { createChatStateStore } from "../../../../../src/features/chat/application/state/store";
import { RestorationController } from "../../../../../src/features/chat/application/threads/restoration-controller";
import { deferred } from "../../../../support/async";

describe("RestorationController", () => {
  it("loads the store-owned restored thread on explicit hydration", async () => {
    const resumeThread = vi.fn().mockResolvedValue(undefined);
    const { controller, stateStore } = restoredThreadControllerFixture();
    stateStore.dispatch({ type: "panel/restored-thread-applied", threadId: "thread", fallbackTitle: "Title" });
    expect(resumeThread).not.toHaveBeenCalled();

    await controller.ensureLoaded(resumeThread);

    expect(resumeThread).toHaveBeenCalledWith("thread");
  });

  it("shares an in-flight restore load", async () => {
    const resume = deferred<undefined>();
    const loadThread = vi.fn(() => resume.promise);
    const { controller, stateStore } = restoredThreadControllerFixture();
    stateStore.dispatch({ type: "panel/restored-thread-applied", threadId: "thread", fallbackTitle: null });

    const first = controller.ensureLoaded(loadThread);
    const second = controller.ensureLoaded(loadThread);
    await Promise.resolve();
    expect(loadThread).toHaveBeenCalledOnce();

    resume.resolve(undefined);
    await Promise.all([first, second]);

    expect(loadThread).toHaveBeenCalledOnce();
  });

  it("does not load a replaced restored thread through a stale request", async () => {
    const first = deferred<undefined>();
    const loadThread = vi.fn(() => first.promise);
    const { controller, stateStore } = restoredThreadControllerFixture();
    stateStore.dispatch({ type: "panel/restored-thread-applied", threadId: "first", fallbackTitle: null });
    const loading = controller.ensureLoaded(loadThread);

    stateStore.dispatch({ type: "panel/restored-thread-applied", threadId: "second", fallbackTitle: null });
    first.resolve(undefined);

    await expect(loading).resolves.toBe(false);
    expect(controller.isPending("second")).toBe(true);
  });

  it("starts a fresh load when the same thread returns after another target", async () => {
    const first = deferred<undefined>();
    const second = deferred<undefined>();
    const loadThread = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const { controller, stateStore } = restoredThreadControllerFixture();
    stateStore.dispatch({ type: "panel/restored-thread-applied", threadId: "thread", fallbackTitle: null });
    const firstLoading = controller.ensureLoaded(loadThread);

    stateStore.dispatch({ type: "panel/restored-thread-applied", threadId: "other", fallbackTitle: null });
    stateStore.dispatch({ type: "panel/restored-thread-applied", threadId: "thread", fallbackTitle: null });
    const secondLoading = controller.ensureLoaded(loadThread);

    expect(loadThread).toHaveBeenCalledTimes(2);
    first.resolve(undefined);
    await expect(firstLoading).resolves.toBe(false);
    second.resolve(undefined);
    await expect(secondLoading).resolves.toBe(false);
  });
});

function restoredThreadControllerFixture() {
  const stateStore = createChatStateStore();
  return { controller: new RestorationController({ stateStore }), stateStore };
}
