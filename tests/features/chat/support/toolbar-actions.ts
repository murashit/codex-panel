import { vi } from "vitest";
import type { ToolbarActions } from "../../../../src/features/chat/ui/toolbar/toolbar";

export function toolbarActionsFixture(): ToolbarActions {
  return {
    primary: {
      toggleHistory: vi.fn(),
      toggleChatActions: vi.fn(),
      toggleStatusPanel: vi.fn(),
    },
    chat: {
      startNewThread: vi.fn(),
      startSideChat: vi.fn(),
      compactContext: vi.fn(),
      setGoal: vi.fn(),
    },
    status: {
      connect: vi.fn(),
      refreshStatus: vi.fn(),
      copyDebugDetails: vi.fn(),
    },
    threads: {
      loadMore: vi.fn(),
      resume: vi.fn(),
      setPinned: vi.fn(),
      archive: {
        start: vi.fn(),
        confirm: vi.fn(),
      },
      rename: {
        start: vi.fn(),
        updateDraft: vi.fn(),
        save: vi.fn(),
        cancel: vi.fn(),
        cancelAutoName: vi.fn(),
        autoName: vi.fn(),
      },
    },
  };
}
