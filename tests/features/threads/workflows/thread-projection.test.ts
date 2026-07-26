import { describe, expect, it } from "vitest";

import type { ThreadCatalogChange } from "../../../../src/domain/threads/catalog-read-model";
import type { Thread } from "../../../../src/domain/threads/model";
import { projectThreadFacts } from "../../../../src/features/threads/workflows/thread-projection";

describe("thread projection", () => {
  it("projects an ordered fact batch without mutating its snapshots", () => {
    const active = [thread("source"), thread("other")];
    const archived: Thread[] = [];

    const changes = projectThreadFacts(
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

  it("requests revalidation when a fact needs a record absent from the snapshot", () => {
    expect(
      projectThreadFacts({ activeThreadsSnapshot: () => null, archivedThreadsSnapshot: () => null }, [
        { type: "thread-archived", threadId: "unknown" },
      ]),
    ).toEqual([
      { kind: "remove", list: "active", threadId: "unknown" },
      { kind: "revalidate", list: "archived" },
    ]);
  });

  it("projects rename, delete, restore, and unarchive facts for both lists", () => {
    const active = [thread("active")];
    const archived = [thread("archived", true)];

    expect(
      projectThreadFacts(
        {
          activeThreadsSnapshot: () => active,
          archivedThreadsSnapshot: () => archived,
        },
        [
          { type: "thread-renamed", threadId: "active", name: "Renamed" },
          { type: "thread-deleted", threadId: "archived" },
          { type: "thread-restored", thread: thread("restored", true) },
          { type: "thread-unarchived", threadId: "restored" },
        ],
      ),
    ).toEqual([
      { kind: "update", list: "active", threadId: "active", changes: { name: "Renamed" } },
      { kind: "update", list: "archived", threadId: "active", changes: { name: "Renamed" } },
      { kind: "remove", list: "active", threadId: "archived" },
      { kind: "remove", list: "archived", threadId: "archived" },
      { kind: "upsert", list: "active", thread: thread("restored") },
      { kind: "remove", list: "archived", threadId: "restored" },
      { kind: "remove", list: "archived", threadId: "restored" },
      { kind: "revalidate", list: "active" },
    ] satisfies ThreadCatalogChange[]);
  });

  it("requests active revalidation when an unarchived thread is absent", () => {
    expect(
      projectThreadFacts({ activeThreadsSnapshot: () => [], archivedThreadsSnapshot: () => [] }, [
        { type: "thread-unarchived", threadId: "unknown" },
      ]),
    ).toEqual([
      { kind: "remove", list: "archived", threadId: "unknown" },
      { kind: "revalidate", list: "active" },
    ] satisfies ThreadCatalogChange[]);
  });

  it("moves an existing archived thread into the active list when unarchived", () => {
    expect(
      projectThreadFacts({ activeThreadsSnapshot: () => [], archivedThreadsSnapshot: () => [thread("archived", true)] }, [
        { type: "thread-unarchived", threadId: "archived" },
      ]),
    ).toEqual([
      { kind: "remove", list: "archived", threadId: "archived" },
      { kind: "upsert", list: "active", thread: thread("archived") },
    ] satisfies ThreadCatalogChange[]);
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
