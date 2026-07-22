import { applyThreadCatalogChange, type ThreadCatalogChange } from "../../../domain/threads/catalog-read-model";
import type { Thread } from "../../../domain/threads/model";
import type { ThreadLifecycleEvent } from "./thread-operation-event";

interface ThreadReadModelSnapshots {
  activeThreadsSnapshot(): readonly Thread[] | null;
  archivedThreadsSnapshot(): readonly Thread[] | null;
}

export function projectThreadCatalogChanges(
  snapshots: ThreadReadModelSnapshots,
  events: readonly ThreadLifecycleEvent[],
): ThreadCatalogChange[] {
  let active = snapshots.activeThreadsSnapshot();
  let archived = snapshots.archivedThreadsSnapshot();
  const changes: ThreadCatalogChange[] = [];
  for (const event of events) {
    const eventChanges = threadListChangesForEvent({ active, archived }, event);
    changes.push(...eventChanges);
    for (const change of eventChanges) {
      if (change.list === "active") active = applyThreadCatalogChange(active, change);
      else archived = applyThreadCatalogChange(archived, change);
    }
  }
  return changes;
}

function threadListChangesForEvent(
  snapshots: { active: readonly Thread[] | null; archived: readonly Thread[] | null },
  event: ThreadLifecycleEvent,
): ThreadCatalogChange[] {
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
          ? [{ kind: "upsert", list: "archived", thread: { ...thread, archived: true } } satisfies ThreadCatalogChange]
          : [{ kind: "revalidate", list: "archived" } satisfies ThreadCatalogChange]),
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
          ? [{ kind: "upsert", list: "active", thread: { ...thread, archived: false } } satisfies ThreadCatalogChange]
          : [{ kind: "revalidate", list: "active" } satisfies ThreadCatalogChange]),
      ];
    }
  }
}

function threadById(threads: readonly Thread[] | null, threadId: string): Thread | null {
  return threads?.find((thread) => thread.id === threadId) ?? null;
}
