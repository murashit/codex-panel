import { describe, expect, it, vi } from "vitest";

import type { AppServerClient } from "../../../../src/app-server/connection/client";
import { ChatResumeWorkTracker } from "../../../../src/features/chat/application/lifecycle";
import { createChatStateStore } from "../../../../src/features/chat/application/state/store";
import type { GoalActions } from "../../../../src/features/chat/application/threads/goal-actions";
import { HistoryController } from "../../../../src/features/chat/application/threads/history-controller";
import { createThreadLifecycleParts } from "../../../../src/features/chat/application/threads/lifecycle-parts";

describe("ThreadLifecycleParts", () => {
  it("uses the provided history and thread invalidation hook", () => {
    const resumeWork = new ChatResumeWorkTracker();
    const stateStore = createChatStateStore();
    const history = new HistoryController({
      stateStore,
      currentClient: () => null as AppServerClient | null,
      addSystemMessage: vi.fn(),
      showLatestPageAtBottom: vi.fn(),
      setThreadTurnPresence: vi.fn(),
    });
    const invalidateThreadWork = vi.fn();
    const parts = createThreadLifecycleParts({
      settingsRef: { vaultPath: "/vault" },
      stateStore,
      client: {
        currentClient: () => null as AppServerClient | null,
        ensureConnected: vi.fn().mockResolvedValue(undefined),
      },
      lifecycle: {
        resumeWork,
        history,
        invalidateThreadWork,
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
      goals: {
        syncThreadGoal: vi.fn().mockResolvedValue(undefined),
      } as unknown as GoalActions,
      resetThreadTurnPresence: vi.fn(),
    });

    parts.restoration.restore({
      threadId: "thread",
      title: "Thread",
      explicitName: null,
    });

    expect(parts.history).toBe(history);
    expect(invalidateThreadWork).toHaveBeenCalledOnce();
  });
});
