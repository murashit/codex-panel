import { applyThreadCatalogChange, type ThreadCatalogChange } from "../../../domain/threads/catalog-read-model";
import { isThreadVisibleInCatalog, type Thread } from "../../../domain/threads/model";
import type { ThreadFact } from "./thread-facts";

interface ThreadReadModelSnapshots {
  activeThreadsSnapshot(): readonly Thread[] | null;
  archivedThreadsSnapshot(): readonly Thread[] | null;
}

export function projectThreadFacts(snapshots: ThreadReadModelSnapshots, facts: readonly ThreadFact[]): ThreadCatalogChange[] {
  let active = snapshots.activeThreadsSnapshot();
  let archived = snapshots.archivedThreadsSnapshot();
  const changes: ThreadCatalogChange[] = [];
  for (const fact of facts) {
    const factChanges = threadListChangesForFact({ active, archived }, fact);
    changes.push(...factChanges);
    for (const change of factChanges) {
      if (change.list === "active") active = applyThreadCatalogChange(active, change);
      else archived = applyThreadCatalogChange(archived, change);
    }
  }
  return changes;
}

function threadListChangesForFact(
  snapshots: { active: readonly Thread[] | null; archived: readonly Thread[] | null },
  fact: ThreadFact,
): ThreadCatalogChange[] {
  switch (fact.type) {
    case "thread-upserted":
      return isThreadVisibleInCatalog(fact.thread) ? [{ kind: "upsert", list: "active", thread: { ...fact.thread, archived: false } }] : [];
    case "thread-renamed":
      return [
        { kind: "update", list: "active", threadId: fact.threadId, changes: { name: fact.name } },
        { kind: "update", list: "archived", threadId: fact.threadId, changes: { name: fact.name } },
      ];
    case "thread-archived": {
      const thread = threadById(snapshots.active, fact.threadId);
      return [
        { kind: "remove", list: "active", threadId: fact.threadId },
        ...(thread
          ? [{ kind: "upsert", list: "archived", thread: { ...thread, archived: true } } satisfies ThreadCatalogChange]
          : [{ kind: "revalidate", list: "archived" } satisfies ThreadCatalogChange]),
      ];
    }
    case "thread-deleted":
      return [
        { kind: "remove", list: "active", threadId: fact.threadId },
        { kind: "remove", list: "archived", threadId: fact.threadId },
      ];
    case "thread-restored":
      return isThreadVisibleInCatalog(fact.thread)
        ? [
            { kind: "upsert", list: "active", thread: { ...fact.thread, archived: false } },
            { kind: "remove", list: "archived", threadId: fact.thread.id },
          ]
        : [];
    case "thread-unarchived": {
      const thread = threadById(snapshots.archived, fact.threadId);
      return [
        { kind: "remove", list: "archived", threadId: fact.threadId },
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
