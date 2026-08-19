import { vi } from "vitest";

import type { Thread } from "../../src/domain/threads/model";
import type { ThreadMutationCommands } from "../../src/features/threads/workflows/thread-mutation-commands";

export function threadMutationCommandsMock(overrides: Partial<ThreadMutationCommands> = {}): ThreadMutationCommands {
  const restored: Thread = {
    historyMode: "unknown",
    id: "restored-thread",
    preview: "Restored thread",
    name: null,
    archived: false,
    createdAt: 1,
    updatedAt: 1,
    provenance: { kind: "interactive" },
  };
  return {
    renameThread: vi.fn<ThreadMutationCommands["renameThread"]>().mockResolvedValue(true),
    setThreadPinned: vi.fn<ThreadMutationCommands["setThreadPinned"]>().mockResolvedValue(undefined),
    archiveThread: vi.fn<ThreadMutationCommands["archiveThread"]>().mockResolvedValue({ kind: "archived", exportedPath: null }),
    restoreThread: vi.fn<ThreadMutationCommands["restoreThread"]>().mockResolvedValue(restored),
    deleteThread: vi.fn<ThreadMutationCommands["deleteThread"]>().mockResolvedValue(undefined),
    ...overrides,
  };
}
