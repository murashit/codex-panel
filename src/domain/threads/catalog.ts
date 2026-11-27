import { isThreadVisibleInCatalog, type Thread } from "./model";

type ThreadCatalogList = "active" | "archived";

export type ThreadCatalogChange =
  | { readonly kind: "upsert"; readonly thread: Thread }
  | { readonly kind: "remove"; readonly list: ThreadCatalogList; readonly threadId: string }
  | {
      readonly kind: "update";
      readonly list: ThreadCatalogList;
      readonly threadId: string;
      readonly changes: Partial<Pick<Thread, "name" | "isPinned" | "recencyAt">>;
    }
  | { readonly kind: "revalidate"; readonly list: ThreadCatalogList };

export function threadCatalogChangeList(change: ThreadCatalogChange): ThreadCatalogList {
  return change.kind === "upsert" ? (change.thread.archived ? "archived" : "active") : change.list;
}

export function applyThreadCatalogChange(snapshot: readonly Thread[] | null, change: ThreadCatalogChange): readonly Thread[] | null {
  if (!snapshot) return null;
  switch (change.kind) {
    case "revalidate":
      return snapshot;
    case "upsert": {
      if (!isThreadVisibleInCatalog(change.thread)) return snapshot;
      const existing = snapshot.filter((thread) => thread.id === change.thread.id);
      if (existing.length === 0) return [change.thread, ...snapshot];
      if (existing.every((thread) => threadCatalogEntryEqual(thread, change.thread))) return snapshot;
      return snapshot.map((thread) => (thread.id === change.thread.id ? change.thread : thread));
    }
    case "remove": {
      if (!snapshot.some((thread) => thread.id === change.threadId)) return snapshot;
      return snapshot.filter((thread) => thread.id !== change.threadId);
    }
    case "update": {
      if (!snapshot.some((thread) => thread.id === change.threadId && !threadCatalogUpdateEqual(thread, change.changes))) return snapshot;
      return snapshot.map((thread) => (thread.id === change.threadId ? { ...thread, ...change.changes } : thread));
    }
  }
}

function threadCatalogEntryEqual(left: Thread, right: Thread): boolean {
  return (
    left.id === right.id &&
    left.preview === right.preview &&
    left.name === right.name &&
    left.archived === right.archived &&
    (left.isPinned === true) === (right.isPinned === true) &&
    left.createdAt === right.createdAt &&
    left.updatedAt === right.updatedAt &&
    left.recencyAt === right.recencyAt &&
    JSON.stringify(left.provenance) === JSON.stringify(right.provenance)
  );
}

function threadCatalogUpdateEqual(thread: Thread, changes: Partial<Pick<Thread, "name" | "isPinned" | "recencyAt">>): boolean {
  return (
    (!Object.hasOwn(changes, "name") || changes.name === thread.name) &&
    (!Object.hasOwn(changes, "isPinned") || (changes.isPinned === true) === (thread.isPinned === true)) &&
    (!Object.hasOwn(changes, "recencyAt") || changes.recencyAt === thread.recencyAt)
  );
}
