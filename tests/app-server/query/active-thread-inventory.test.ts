import { describe, expect, it } from "vitest";

import {
  type ActiveThreadData,
  activeThreadDataHasMore,
  activeThreadsFromData,
  applyActiveThreadMutation,
  recentActiveThreadsFromData,
} from "../../../src/app-server/query/active-thread-inventory";
import type { Thread } from "../../../src/domain/threads/model";

describe("active thread inventory", () => {
  it("flattens pages, removes duplicate ids, and sorts by recency stably", () => {
    const data = inventory([
      page([thread("older", 1), thread("same", 3)], "next", 2),
      page([thread("same", 3), thread("newer", 5)], null, 2),
    ]);

    expect(activeThreadsFromData(data)?.map((item) => item.id)).toEqual(["newer", "same", "older"]);
  });

  it("keeps subagent threads out of the catalog inventory", () => {
    expect(
      activeThreadsFromData(inventory([page([thread("interactive", 2), subagent("child", 3)], null, 2)]))?.map((item) => item.id),
    ).toEqual(["interactive"]);
  });

  it("keeps the fetched recent window while retaining at least one thread", () => {
    expect(
      recentActiveThreadsFromData(inventory([page([thread("first", 5), thread("second", 4)], null, 1)]))?.map((item) => item.id),
    ).toEqual(["first"]);
    expect(
      recentActiveThreadsFromData(inventory([page([thread("first", 5), thread("second", 4)], null, 0)]))?.map((item) => item.id),
    ).toEqual(["first"]);
    expect(recentActiveThreadsFromData(inventory([page([], null, 0)]))).toEqual([]);
  });

  it("reports pagination and empty data without throwing", () => {
    expect(activeThreadsFromData(undefined)).toBeNull();
    expect(recentActiveThreadsFromData(undefined)).toBeNull();
    expect(activeThreadDataHasMore(undefined)).toBe(false);
    expect(activeThreadDataHasMore(inventory([page([], "next", 0)]))).toBe(true);
    expect(activeThreadDataHasMore(inventory([page([], null, 0)]))).toBe(false);
    expect(activeThreadDataHasMore(inventory([]))).toBe(false);
  });

  it("applies active upserts across pages and preserves identity for no-ops", () => {
    const original = inventory([page([thread("existing", 1)], "next", 1), page([thread("other", 2)], null, 1)]);
    const unchanged = applyActiveThreadMutation(original, { kind: "upsert", list: "active", thread: thread("existing", 1) });
    expect(unchanged).toBe(original);

    const updated = applyActiveThreadMutation(original, {
      kind: "upsert",
      list: "active",
      thread: { ...thread("existing", 3), name: "Renamed" },
    });
    expect(updated?.pages.flatMap((page) => page.threads).map((item) => [item.id, item.name, item.recencyAt])).toEqual([
      ["existing", "Renamed", 3],
      ["other", null, 2],
    ]);

    const inserted = applyActiveThreadMutation(original, { kind: "upsert", list: "active", thread: thread("new", 4) });
    expect(inserted?.pages[0]?.threads.map((item) => item.id)).toEqual(["new", "existing"]);
    expect(applyActiveThreadMutation(inventory([]), { kind: "upsert", list: "active", thread: thread("new", 4) })).toEqual(inventory([]));
  });

  it("applies meaningful updates and removals, while ignoring unrelated changes", () => {
    const original = inventory([page([thread("first", 1), thread("second", 2)], null, 2)]);
    const same = applyActiveThreadMutation(original, {
      kind: "update",
      list: "active",
      threadId: "first",
      changes: { name: null },
    });
    expect(same).toBe(original);

    const updated = applyActiveThreadMutation(original, {
      kind: "update",
      list: "active",
      threadId: "first",
      changes: { name: "First", recencyAt: 9 },
    });
    expect(updated?.pages[0]?.threads[0]).toMatchObject({ id: "first", name: "First", recencyAt: 9 });

    const recencyOnly = applyActiveThreadMutation(original, {
      kind: "update",
      list: "active",
      threadId: "first",
      changes: { recencyAt: 9 },
    });
    expect(recencyOnly?.pages[0]?.threads[0]?.recencyAt).toBe(9);

    const removed = applyActiveThreadMutation(original, { kind: "remove", list: "active", threadId: "first" });
    expect(removed?.pages[0]?.threads.map((item) => item.id)).toEqual(["second"]);
    expect(applyActiveThreadMutation(original, { kind: "remove", list: "active", threadId: "missing" })).toBe(original);
    expect(applyActiveThreadMutation(original, { kind: "revalidate", list: "active" })).toBe(original);
    expect(applyActiveThreadMutation(original, { kind: "remove", list: "archived", threadId: "first" })).toBe(original);
    expect(applyActiveThreadMutation(undefined, { kind: "remove", list: "active", threadId: "first" })).toBeUndefined();
  });
});

function inventory(pages: ActiveThreadData["pages"]): ActiveThreadData {
  return { pages, pageParams: pages.map((_, index) => (index === 0 ? null : "cursor")) };
}

function page(threads: readonly Thread[], nextCursor: string | null, fetchedSize: number) {
  return { threads, nextCursor, fetchedSize };
}

function thread(id: string, recencyAt: number): Thread {
  return {
    id,
    preview: id,
    name: null,
    archived: false,
    createdAt: 1,
    updatedAt: 1,
    recencyAt,
    provenance: { kind: "interactive" },
  };
}

function subagent(id: string, recencyAt: number): Thread {
  return {
    ...thread(id, recencyAt),
    provenance: {
      kind: "subagent",
      subagentKind: "thread-spawn",
      parentThreadId: "parent",
      sessionId: null,
      depth: 1,
      agentNickname: null,
      agentRole: null,
    },
  };
}
