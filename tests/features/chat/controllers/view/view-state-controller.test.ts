import { describe, expect, it, vi } from "vitest";

import {
  ChatViewStateController,
  type ChatViewStateControllerHost,
} from "../../../../../src/features/chat/controllers/view/view-state-controller";

function createController(overrides: Partial<ChatViewStateControllerHost> = {}) {
  const host: ChatViewStateControllerHost = {
    invalidateResumeWork: vi.fn(),
    clearRestoredThreadLifecycle: vi.fn(),
    clearDeferredRestoredThreadHydration: vi.fn(),
    scheduleDeferredAppServerWarmup: vi.fn(),
    restoreThreadPlaceholder: vi.fn(),
    ...overrides,
  };
  return { controller: new ChatViewStateController(host), host };
}

describe("ChatViewStateController", () => {
  it("restores a thread placeholder from persisted view state", () => {
    const { controller, host } = createController();

    controller.applyState({ threadId: "thread", threadTitle: "Title" });

    expect(host.restoreThreadPlaceholder).toHaveBeenCalledWith({
      threadId: "thread",
      title: "Title",
      explicitName: null,
    });
    expect(host.invalidateResumeWork).not.toHaveBeenCalled();
    expect(host.scheduleDeferredAppServerWarmup).not.toHaveBeenCalled();
  });

  it("clears restored lifecycle and schedules warmup when no thread is restored", () => {
    const { controller, host } = createController();

    controller.applyState({ version: 1 });

    expect(host.invalidateResumeWork).toHaveBeenCalledOnce();
    expect(host.clearRestoredThreadLifecycle).toHaveBeenCalledOnce();
    expect(host.clearDeferredRestoredThreadHydration).toHaveBeenCalledOnce();
    expect(host.scheduleDeferredAppServerWarmup).toHaveBeenCalledOnce();
    expect(host.restoreThreadPlaceholder).not.toHaveBeenCalled();
  });
});
