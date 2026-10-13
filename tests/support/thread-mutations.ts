import { vi } from "vitest";

import type { ThreadMutationCommands } from "../../src/features/threads/workflows/thread-mutation-commands";

import { panelThreadFixture } from "./panel-thread";

export function threadMutationCommandsMock(overrides: Partial<ThreadMutationCommands> = {}): ThreadMutationCommands {
  const restored = panelThreadFixture({
    id: "restored-thread",
    preview: "Restored thread",
  });
  return {
    renameThread: vi.fn<ThreadMutationCommands["renameThread"]>().mockResolvedValue(true),
    setThreadPinned: vi.fn<ThreadMutationCommands["setThreadPinned"]>().mockResolvedValue(undefined),
    archiveThread: vi.fn<ThreadMutationCommands["archiveThread"]>().mockResolvedValue({ kind: "archived", exportedPath: null }),
    restoreThread: vi.fn<ThreadMutationCommands["restoreThread"]>().mockResolvedValue(restored),
    deleteThread: vi.fn<ThreadMutationCommands["deleteThread"]>().mockResolvedValue(undefined),
    ...overrides,
  };
}
