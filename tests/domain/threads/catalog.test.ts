import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

import { applyThreadCatalogChange, threadCatalogEntryEqual } from "../../../src/domain/threads/catalog";
import type { Thread } from "../../../src/domain/threads/model";

describe("thread catalog read model", () => {
  it("upserts one thread without reordering or replacing unrelated entries", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: 20 }), { maxLength: 12 }),
        fc.integer({ min: 0, max: 20 }),
        fc.string({ maxLength: 20 }),
        (ids, targetId, name) => {
          const snapshot = ids.map((id) => thread(String(id)));
          const next = { ...thread(String(targetId)), name };
          const result = applyThreadCatalogChange(snapshot, { kind: "upsert", list: "active", thread: next });
          expect(result).not.toBeNull();
          if (!result) return;

          const index = ids.indexOf(targetId);
          expect(result.map((item) => item.id)).toEqual(index < 0 ? [String(targetId), ...ids.map(String)] : ids.map(String));
          expect(result.filter((item) => item.id === String(targetId))).toHaveLength(1);
          for (const original of snapshot) {
            if (original.id !== String(targetId)) expect(result.find((item) => item.id === original.id)).toBe(original);
          }
          if (index >= 0 && name === snapshot[index]?.name) expect(result).toBe(snapshot);
          else expect(result.find((item) => item.id === String(targetId))).toEqual(next);
        },
      ),
    );
  });

  it("removes only the requested thread and preserves no-op snapshots", () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.integer({ min: 0, max: 20 }), { maxLength: 12 }), fc.integer({ min: 0, max: 20 }), (ids, targetId) => {
        const snapshot = ids.map((id) => thread(String(id)));
        const result = applyThreadCatalogChange(snapshot, { kind: "remove", list: "active", threadId: String(targetId) });
        expect(result?.map((item) => item.id)).toEqual(ids.filter((id) => id !== targetId).map(String));
        if (!ids.includes(targetId)) expect(result).toBe(snapshot);
        for (const original of snapshot) {
          if (original.id !== String(targetId)) expect(result?.find((item) => item.id === original.id)).toBe(original);
        }
      }),
    );
  });

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

  it("treats changed provenance as a non-equivalent catalog entry", () => {
    expect(
      threadCatalogEntryEqual(thread("thread"), {
        ...thread("thread"),
        provenance: {
          kind: "subagent",
          subagentKind: "review",
          parentThreadId: null,
          sessionId: null,
          depth: 1,
          agentNickname: null,
          agentRole: null,
        },
      }),
    ).toBe(false);
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
