import { describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../../../src/app-server/connection/client";
import { ChatResumeWorkTracker, type ChatViewDeferredTasks } from "../../../../src/features/chat/application/lifecycle";
import { createChatStateStore } from "../../../../src/features/chat/application/state/store";
import type { GoalActions } from "../../../../src/features/chat/application/threads/goal-actions";
import { createThreadLifecycleParts } from "../../../../src/features/chat/application/threads/lifecycle-parts";

describe("ThreadLifecycleParts", () => {
  it("invalidates resume and history work together", () => {
    const resumeWork = new ChatResumeWorkTracker();
    const resume = resumeWork.begin("thread");
    const parts = createThreadLifecycleParts({
      settingsRef: { vaultPath: "/vault" },
      stateStore: createChatStateStore(),
      client: {
        currentClient: () => null as AppServerClient | null,
        ensureConnected: vi.fn().mockResolvedValue(undefined),
      },
      lifecycle: {
        deferredTasks: deferredTasks(),
        resumeWork,
        getOpened: () => true,
        getClosing: () => false,
      },
      thread: {
        notifyIdentityChanged: vi.fn(),
        refreshTabHeader: vi.fn(),
      },
      status: {
        set: vi.fn(),
        addSystemMessage: vi.fn(),
      },
      liveState: {
        refresh: vi.fn(),
      },
      scroll: {
        preservePosition: vi.fn(),
        forceBottom: vi.fn(),
      },
      goals: {
        syncThreadGoal: vi.fn().mockResolvedValue(undefined),
      } as unknown as GoalActions,
      resetThreadTurnPresence: vi.fn(),
    });
    const invalidateHistory = vi.spyOn(parts.history, "invalidate");

    parts.invalidate();

    expect(resumeWork.isStale(resume)).toBe(true);
    expect(invalidateHistory).toHaveBeenCalledOnce();
  });
});

function deferredTasks(): ChatViewDeferredTasks {
  return {
    scheduleDiagnostics: vi.fn(),
    clearDiagnostics: vi.fn(),
    scheduleRestoredThreadHydration: vi.fn(),
    clearRestoredThreadHydration: vi.fn(),
    scheduleAppServerWarmup: vi.fn(),
    clearAppServerWarmup: vi.fn(),
    clearAll: vi.fn(),
  };
}
