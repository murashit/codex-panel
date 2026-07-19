import type { Thread } from "../../domain/threads/model";

export type ThreadListKind = "active" | "archived";

export type ThreadListMutation =
  | { readonly kind: "upsert"; readonly list: ThreadListKind; readonly thread: Thread }
  | { readonly kind: "remove"; readonly list: ThreadListKind; readonly threadId: string }
  | {
      readonly kind: "update";
      readonly list: ThreadListKind;
      readonly threadId: string;
      readonly changes: Partial<Pick<Thread, "name" | "recencyAt">>;
    }
  | { readonly kind: "refresh"; readonly list: ThreadListKind };

export function applyThreadListMutation(snapshot: readonly Thread[] | null, mutation: ThreadListMutation): readonly Thread[] | null {
  switch (mutation.kind) {
    case "refresh":
      return snapshot;
    case "upsert": {
      if (!snapshot) return null;
      const index = snapshot.findIndex((thread) => thread.id === mutation.thread.id);
      if (index < 0) return [mutation.thread, ...snapshot];
      return snapshot.map((thread) => (thread.id === mutation.thread.id ? mutation.thread : thread));
    }
    case "remove":
      return snapshot?.filter((thread) => thread.id !== mutation.threadId) ?? null;
    case "update":
      return snapshot?.map((thread) => (thread.id === mutation.threadId ? { ...thread, ...mutation.changes } : thread)) ?? null;
  }
}
