import { vi } from "vitest";
import {
  EMPTY_THREAD_ACTIVITY,
  type ObserveThreadListActivity,
  type PanelThreadActivity,
  type ThreadListActivity,
  threadListActivity,
} from "../../src/domain/threads/activity";

import type { ThreadMutationCommands } from "../../src/features/threads/workflows/thread-mutation-commands";

import { panelThreadFixture } from "./panel-thread";

export const observeNoThreadActivity: ObserveThreadListActivity = (changed) => {
  changed(EMPTY_THREAD_ACTIVITY);
  return () => undefined;
};

export function threadListActivityFixture(panels: readonly PanelThreadActivity[] = []) {
  let activity = threadListActivity(panels);
  const listeners = new Set<(value: ThreadListActivity) => void>();
  return {
    observe(changed: (value: ThreadListActivity) => void) {
      listeners.add(changed);
      changed(activity);
      return () => listeners.delete(changed);
    },
    publish(archiving: readonly string[], openPanels: readonly PanelThreadActivity[] = []) {
      activity = threadListActivity(openPanels, archiving);
      for (const changed of listeners) changed(activity);
    },
  };
}

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
