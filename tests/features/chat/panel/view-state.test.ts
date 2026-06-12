import { describe, expect, it, vi } from "vitest";

import { applyChatViewState, type ChatViewStateHost } from "../../../../src/features/chat/panel/view-state";

function createHost(overrides: Partial<ChatViewStateHost> = {}) {
  const host: ChatViewStateHost = {
    invalidateResumeWork: vi.fn(),
    clearRestoredThreadLifecycle: vi.fn(),
    clearDeferredRestoredThreadHydration: vi.fn(),
    scheduleDeferredAppServerWarmup: vi.fn(),
    restoreThreadPlaceholder: vi.fn(),
    ...overrides,
  };
  return { host };
}

describe("applyChatViewState", () => {
  it("restores a thread placeholder from persisted view state", () => {
    const { host } = createHost();

    applyChatViewState(host, { threadId: "thread", threadTitle: "Title" });

    expect(host.restoreThreadPlaceholder).toHaveBeenCalledWith({
      threadId: "thread",
      title: "Title",
      explicitName: null,
    });
    expect(host.invalidateResumeWork).not.toHaveBeenCalled();
    expect(host.scheduleDeferredAppServerWarmup).not.toHaveBeenCalled();
  });

  it("clears restored lifecycle and schedules warmup when no thread is restored", () => {
    const { host } = createHost();

    applyChatViewState(host, { version: 1 });

    expect(host.invalidateResumeWork).toHaveBeenCalledOnce();
    expect(host.clearRestoredThreadLifecycle).toHaveBeenCalledOnce();
    expect(host.clearDeferredRestoredThreadHydration).toHaveBeenCalledOnce();
    expect(host.scheduleDeferredAppServerWarmup).toHaveBeenCalledOnce();
    expect(host.restoreThreadPlaceholder).not.toHaveBeenCalled();
  });
});
