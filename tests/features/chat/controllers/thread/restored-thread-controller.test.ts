// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { RestoredThreadController } from "../../../../../src/features/chat/controllers/thread/restored-thread-controller";
import { ChatViewDeferredTasks } from "../../../../../src/features/chat/view-lifecycle";
import type { ChatAction } from "../../../../../src/features/chat/chat-state";

describe("RestoredThreadController", () => {
  it("restores a placeholder and schedules deferred hydration", () => {
    vi.useFakeTimers();
    const actions: ChatAction[] = [];
    const resumeThread = vi.fn().mockResolvedValue(undefined);
    const controller = new RestoredThreadController({
      deferredTasks: new ChatViewDeferredTasks(() => window),
      opened: () => true,
      resumeThread,
      invalidateResumeWork: vi.fn(),
      dispatch: (action) => actions.push(action),
      systemItem: (text) => ({ id: "system", kind: "system", role: "system", text }),
      setStatus: vi.fn(),
      refreshTabHeader: vi.fn(),
    });

    controller.restore({ threadId: "thread", title: "Title", explicitName: null });

    expect(controller.placeholder()).toMatchObject({ threadId: "thread", title: "Title" });
    expect(actions).toHaveLength(1);
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

function restoredThreadControllerFixture(overrides: Partial<ConstructorParameters<typeof RestoredThreadController>[0]> = {}) {
  return new RestoredThreadController({
    deferredTasks: new ChatViewDeferredTasks(() => window),
    opened: () => false,
    resumeThread: vi.fn().mockResolvedValue(undefined),
    invalidateResumeWork: vi.fn(),
    dispatch: vi.fn(),
    systemItem: (text) => ({ id: "system", kind: "system", role: "system", text }),
    setStatus: vi.fn(),
    refreshTabHeader: vi.fn(),
    ...overrides,
  });
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}
