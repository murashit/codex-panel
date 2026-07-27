import { isThreadVisibleInCatalog, type Thread } from "./model";

export type ThreadCatalogList = "active" | "archived";

export type ThreadCatalogChange =
  | { readonly kind: "upsert"; readonly list: ThreadCatalogList; readonly thread: Thread }
  | { readonly kind: "remove"; readonly list: ThreadCatalogList; readonly threadId: string }
  | {
      readonly kind: "update";
      readonly list: ThreadCatalogList;
      readonly threadId: string;
      readonly changes: Partial<Pick<Thread, "name" | "recencyAt">>;
    }
  | { readonly kind: "revalidate"; readonly list: ThreadCatalogList };

export function applyThreadCatalogChange(snapshot: readonly Thread[] | null, change: ThreadCatalogChange): readonly Thread[] | null {
  switch (change.kind) {
    case "revalidate":
      return snapshot;
    case "upsert": {
      if (!isThreadVisibleInCatalog(change.thread)) return snapshot;
      if (!snapshot) return null;
      const index = snapshot.findIndex((thread) => thread.id === change.thread.id);
      if (index < 0) return [change.thread, ...snapshot];
      if (threadCatalogEntryEqual(snapshot[index], change.thread)) return snapshot;
      return snapshot.map((thread) => (thread.id === change.thread.id ? change.thread : thread));
    }
    case "remove": {
      if (!snapshot?.some((thread) => thread.id === change.threadId)) return snapshot;
      return snapshot.filter((thread) => thread.id !== change.threadId);
    }
    case "update": {
      if (!snapshot) return null;
      const current = snapshot.find((thread) => thread.id === change.threadId);
      if (!current || threadCatalogUpdateEqual(current, change.changes)) return snapshot;
      return snapshot.map((thread) => (thread.id === change.threadId ? { ...thread, ...change.changes } : thread));
    }
  }
}

export function threadCatalogEntryEqual(left: Thread | undefined, right: Thread): boolean {
  if (!left) return false;
  return (
    left.id === right.id &&
    left.preview === right.preview &&
    left.name === right.name &&
    left.archived === right.archived &&
    left.createdAt === right.createdAt &&
    left.updatedAt === right.updatedAt &&
    left.recencyAt === right.recencyAt &&
    left.canAcceptDirectInput === right.canAcceptDirectInput &&
    JSON.stringify(left.provenance) === JSON.stringify(right.provenance)
  );
}

function threadCatalogUpdateEqual(thread: Thread, changes: Partial<Pick<Thread, "name" | "recencyAt">>): boolean {
  return (
    (!Object.hasOwn(changes, "name") || changes.name === thread.name) &&
    (!Object.hasOwn(changes, "recencyAt") || changes.recencyAt === thread.recencyAt)
  );
}
