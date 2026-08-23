import { describe, expect, it } from "vitest";

import { applyThreadCatalogChange, threadCatalogEntryEqual } from "../../../src/domain/threads/catalog-read-model";
import type { Thread } from "../../../src/domain/threads/model";

describe("thread catalog read model", () => {
  it("applies upsert changes without replacing equivalent snapshots", () => {
    const first = thread("first");
    const second = thread("second");
    const snapshot = [first, second] as const;

    expect(applyThreadCatalogChange(null, { kind: "upsert", list: "active", thread: first })).toBeNull();
    expect(applyThreadCatalogChange(snapshot, { kind: "upsert", list: "active", thread: thread("new") })).toEqual([
      thread("new"),
      first,
      second,
    ]);
    expect(applyThreadCatalogChange(snapshot, { kind: "upsert", list: "active", thread: first })).toBe(snapshot);
    expect(
      applyThreadCatalogChange(snapshot, {
        kind: "upsert",
        list: "active",
        thread: { ...first, name: "renamed" },
      }),
    ).toEqual([{ ...first, name: "renamed" }, second]);
  });

  it("removes only matching threads and preserves no-op snapshots", () => {
    const snapshot = [thread("first"), thread("second")];

    expect(applyThreadCatalogChange(snapshot, { kind: "remove", list: "active", threadId: "missing" })).toBe(snapshot);
    expect(applyThreadCatalogChange(snapshot, { kind: "remove", list: "active", threadId: "first" })).toEqual([thread("second")]);
  });

  it("updates named fields only when the thread actually changes", () => {
    const snapshot = [thread("first"), thread("second")];

    expect(applyThreadCatalogChange(null, { kind: "update", list: "active", threadId: "first", changes: { name: "new" } })).toBeNull();
    expect(applyThreadCatalogChange(snapshot, { kind: "update", list: "active", threadId: "missing", changes: { name: "new" } })).toBe(
      snapshot,
    );
    expect(applyThreadCatalogChange(snapshot, { kind: "update", list: "active", threadId: "first", changes: { name: "first" } })).toBe(
      snapshot,
    );
    expect(applyThreadCatalogChange(snapshot, { kind: "update", list: "active", threadId: "first", changes: { recencyAt: 1 } })).toBe(
      snapshot,
    );
    expect(applyThreadCatalogChange(snapshot, { kind: "update", list: "active", threadId: "first", changes: { recencyAt: 10 } })).toEqual([
      { ...snapshot[0], recencyAt: 10 },
      snapshot[1],
    ]);
  });

  it("keeps revalidation as an identity-preserving event", () => {
    const snapshot = [thread("first")];

    expect(applyThreadCatalogChange(snapshot, { kind: "revalidate", list: "active" })).toBe(snapshot);
  });

  const changedFields = [
    ["name", { name: "changed" }],
    [
      "provenance",
      {
        provenance: {
          kind: "subagent",
          subagentKind: "review",
          parentThreadId: null,
          sessionId: null,
          depth: 1,
          agentNickname: null,
          agentRole: null,
        },
      },
    ],
  ] satisfies ReadonlyArray<readonly [string, Partial<Thread>]>;

  it.each(changedFields)("treats a changed %s field as a non-equivalent catalog entry", (_field, change) => {
    expect(threadCatalogEntryEqual(thread("thread"), { ...thread("thread"), ...change })).toBe(false);
  });
});

function thread(id: string): Thread {
  return {
    id,
    preview: `Preview ${id}`,
    name: id,
    archived: false,
    createdAt: 1,
    updatedAt: 1,
    recencyAt: 1,
    provenance: { kind: "interactive" },
  };
}
