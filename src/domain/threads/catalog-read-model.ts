import type { Thread } from "./model";

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
      if (!snapshot) return null;
      const index = snapshot.findIndex((thread) => thread.id === change.thread.id);
      if (index < 0) return [change.thread, ...snapshot];
      return snapshot.map((thread) => (thread.id === change.thread.id ? change.thread : thread));
    }
    case "remove":
      return snapshot?.filter((thread) => thread.id !== change.threadId) ?? null;
    case "update":
      return snapshot?.map((thread) => (thread.id === change.threadId ? { ...thread, ...change.changes } : thread)) ?? null;
  }
}
