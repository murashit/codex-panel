import { applyThreadListMutation, type ThreadListMutation } from "../../../app-server/query/thread-list-mutation";
import type { Thread } from "../../../domain/threads/model";
import type { ThreadLifecycleEvent } from "./thread-operation-event";

interface ThreadReadModelSnapshots {
  activeThreadsSnapshot(): readonly Thread[] | null;
  archivedThreadsSnapshot(): readonly Thread[] | null;
}

export function projectThreadListChanges(
  snapshots: ThreadReadModelSnapshots,
  events: readonly ThreadLifecycleEvent[],
): ThreadListMutation[] {
  let active = snapshots.activeThreadsSnapshot();
  let archived = snapshots.archivedThreadsSnapshot();
  const changes: ThreadListMutation[] = [];
  for (const event of events) {
    const eventChanges = threadListChangesForEvent({ active, archived }, event);
    changes.push(...eventChanges);
    for (const change of eventChanges) {
      if (change.list === "active") active = applyThreadListMutation(active, change);
      else archived = applyThreadListMutation(archived, change);
    }
  }
  return changes;
}

function threadListChangesForEvent(
  snapshots: { active: readonly Thread[] | null; archived: readonly Thread[] | null },
  event: ThreadLifecycleEvent,
): ThreadListMutation[] {
  switch (event.type) {
    case "thread-upserted":
      return [{ kind: "upsert", list: "active", thread: { ...event.thread, archived: false } }];
    case "thread-renamed":
      return [
        { kind: "update", list: "active", threadId: event.threadId, changes: { name: event.name } },
        { kind: "update", list: "archived", threadId: event.threadId, changes: { name: event.name } },
      ];
    case "thread-archived": {
      const thread = threadById(snapshots.active, event.threadId);
      return [
        { kind: "remove", list: "active", threadId: event.threadId },
        ...(thread
          ? [{ kind: "upsert", list: "archived", thread: { ...thread, archived: true } } satisfies ThreadListMutation]
          : [{ kind: "refresh", list: "archived" } satisfies ThreadListMutation]),
      ];
    }
    case "thread-deleted":
      return [
        { kind: "remove", list: "active", threadId: event.threadId },
        { kind: "remove", list: "archived", threadId: event.threadId },
      ];
    case "thread-restored":
      return [
        { kind: "upsert", list: "active", thread: { ...event.thread, archived: false } },
        { kind: "remove", list: "archived", threadId: event.thread.id },
      ];
    case "thread-unarchived": {
      const thread = threadById(snapshots.archived, event.threadId);
      return [
        { kind: "remove", list: "archived", threadId: event.threadId },
        ...(thread
          ? [{ kind: "upsert", list: "active", thread: { ...thread, archived: false } } satisfies ThreadListMutation]
          : [{ kind: "refresh", list: "active" } satisfies ThreadListMutation]),
      ];
    }
  }
}

function threadById(threads: readonly Thread[] | null, threadId: string): Thread | null {
  return threads?.find((thread) => thread.id === threadId) ?? null;
}
