import { applyThreadCatalogChange, type ThreadCatalogChange, threadCatalogChangeList } from "../../domain/threads/catalog";
import type { ThreadFact } from "../../domain/threads/facts";
import { isThreadVisibleInCatalog, type Thread } from "../../domain/threads/model";

interface ThreadLists {
  active: readonly Thread[] | null;
  archived: readonly Thread[] | null;
}

export function projectThreadFacts(snapshots: ThreadLists, facts: readonly ThreadFact[]): ThreadCatalogChange[] {
  const lists = { ...snapshots };
  const changes: ThreadCatalogChange[] = [];
  for (const fact of facts) {
    for (const change of threadListChangesForFact(lists, fact)) {
      const list = threadCatalogChangeList(change);
      lists[list] = applyThreadCatalogChange(lists[list], change);
      changes.push(change);
    }
  }
  return changes;
}

function threadListChangesForFact(snapshots: ThreadLists, fact: ThreadFact): ThreadCatalogChange[] {
  switch (fact.type) {
    case "thread-upserted":
      return isThreadVisibleInCatalog(fact.thread) ? [{ kind: "upsert", thread: { ...fact.thread, archived: false } }] : [];
    case "thread-renamed":
    case "thread-pinned": {
      const changes = fact.type === "thread-renamed" ? { name: fact.name } : { isPinned: fact.isPinned };
      return [
        { kind: "update", list: "active", threadId: fact.threadId, changes },
        { kind: "update", list: "archived", threadId: fact.threadId, changes },
      ];
    }
    case "thread-archived":
    case "thread-unarchived": {
      const archived = fact.type === "thread-archived";
      const from = archived ? "active" : "archived";
      const thread = snapshots[from]?.find((thread) => thread.id === fact.threadId);
      return [
        { kind: "remove", list: from, threadId: fact.threadId },
        thread ? { kind: "upsert", thread: { ...thread, archived } } : { kind: "revalidate", list: archived ? "archived" : "active" },
      ];
    }
    case "thread-deleted":
      return [
        { kind: "remove", list: "active", threadId: fact.threadId },
        { kind: "remove", list: "archived", threadId: fact.threadId },
      ];
  }
}
