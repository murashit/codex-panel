import { describe, expect, it } from "vitest";

import type { ThreadCatalogChange } from "../../../../src/domain/threads/catalog-read-model";
import type { Thread } from "../../../../src/domain/threads/model";
import { projectThreadCatalogChanges } from "../../../../src/features/threads/workflows/thread-read-model-projection";

describe("ThreadReadModelProjection", () => {
  it("projects an ordered operation event batch without mutating its snapshots", () => {
    const active = [thread("source"), thread("other")];
    const archived: Thread[] = [];

    const changes = projectThreadCatalogChanges(
      {
        activeThreadsSnapshot: () => active,
        archivedThreadsSnapshot: () => archived,
      },
      [
        { type: "thread-upserted", thread: thread("child") },
        { type: "thread-archived", threadId: "child" },
        { type: "thread-archived", threadId: "source" },
      ],
    );

    expect(changes).toEqual([
      { kind: "upsert", list: "active", thread: thread("child") },
      { kind: "remove", list: "active", threadId: "child" },
      { kind: "upsert", list: "archived", thread: thread("child", true) },
      { kind: "remove", list: "active", threadId: "source" },
      { kind: "upsert", list: "archived", thread: thread("source", true) },
    ] satisfies ThreadCatalogChange[]);
    expect(active).toEqual([thread("source"), thread("other")]);
    expect(archived).toEqual([]);
  });

  it("requests revalidation when an event needs a record absent from the snapshot", () => {
    expect(
      projectThreadCatalogChanges({ activeThreadsSnapshot: () => null, archivedThreadsSnapshot: () => null }, [
        { type: "thread-archived", threadId: "unknown" },
      ]),
    ).toEqual([
      { kind: "remove", list: "active", threadId: "unknown" },
      { kind: "revalidate", list: "archived" },
    ]);
  });
});

function thread(id: string, archived = false): Thread {
  return {
    id,
    preview: id,
    name: null,
    archived,
    createdAt: 1,
    updatedAt: 1,
    provenance: { kind: "interactive" },
  };
}
