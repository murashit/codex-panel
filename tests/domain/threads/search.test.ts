import { describe, expect, it } from "vitest";

import type { Thread } from "../../../src/domain/threads/model";
import { resolveThreadSearchQuery, threadSearchMatches } from "../../../src/domain/threads/search";

describe("thread search", () => {
  it("ranks title prefixes and title includes before fuzzy matches", () => {
    const threads = [
      thread({ id: "thread-alpha", name: "Older Alpha", updatedAt: 10 }),
      thread({ id: "thread-beta", name: "Recent unrelated alpha mention", updatedAt: 30 }),
      thread({ id: "alpha-thread", name: "Newest unrelated", updatedAt: 40 }),
      thread({ id: "thread-title", name: "Alpha starts", updatedAt: 5 }),
      thread({ id: "thread-fuzzy", name: "Architecture proposal", updatedAt: 50 }),
    ];

    expect(threadSearchMatches(threads, "alpha").map((match) => match.thread.id)).toEqual(["thread-title", "thread-beta", "thread-alpha"]);
    expect(threadSearchMatches(threads, "ctpr").map((match) => match.thread.id)).toEqual(["thread-fuzzy"]);
  });

  it("resolves a unique stronger match without using recency to break same-score ambiguity", () => {
    expect(
      resolveThreadSearchQuery(
        [thread({ id: "thread-alpha", name: "Alpha plan" }), thread({ id: "thread-beta", name: "Older Alpha plan" })],
        "alpha",
      ),
    ).toMatchObject({ kind: "match", match: { thread: { id: "thread-alpha" } } });

    expect(
      resolveThreadSearchQuery(
        [
          thread({ id: "thread-alpha", name: "Alpha plan", updatedAt: 1 }),
          thread({ id: "thread-beta", name: "Alpha notes", updatedAt: 2 }),
        ],
        "alpha",
      ),
    ).toMatchObject({ kind: "multiple" });
  });

  it("prefers an exact title over another title with the same prefix", () => {
    expect(
      resolveThreadSearchQuery([thread({ id: "exact", name: "Alpha" }), thread({ id: "prefix", name: "Alpha notes" })], "alpha"),
    ).toMatchObject({ kind: "match", match: { thread: { id: "exact" } } });
  });

  it("does not match full or short ids", () => {
    const threads = [
      thread({ id: "019abcde-0000-7000-8000-000000000001", name: "Project notes" }),
      thread({ id: "thread-other", name: "019abcde planning" }),
    ];

    expect(threadSearchMatches(threads, "019abcde").map((match) => match.thread.id)).toEqual(["thread-other"]);
    expect(threadSearchMatches(threads, "019abcde-0000-7000-8000-000000000001")).toEqual([]);
  });

  it("uses the preview as the searchable title when no explicit name exists", () => {
    const unnamed = thread({ id: "thread-preview", preview: "Investigate query pagination" });

    expect(threadSearchMatches([unnamed], "pagination")).toMatchObject([
      { thread: { id: "thread-preview" }, title: "Investigate query pagination" },
    ]);
  });

  it("uses recency for empty searches", () => {
    expect(
      threadSearchMatches(
        [thread({ id: "updated-newer", updatedAt: 20, recencyAt: 10 }), thread({ id: "recent", updatedAt: 10, recencyAt: 30 })],
        "",
      ).map((match) => match.thread.id),
    ).toEqual(["recent", "updated-newer"]);
  });

  it("normalizes padded queries and returns a normalized query when nothing matches", () => {
    const threads = [thread({ id: "alpha", name: "Alpha" })];

    expect(threadSearchMatches(threads, "  ALPHA  ").map((match) => match.thread.id)).toEqual(["alpha"]);
    expect(resolveThreadSearchQuery(threads, "  missing  ")).toEqual({ kind: "none", query: "missing" });
  });

  it("ranks a substring above a newer fuzzy match", () => {
    const threads = [
      thread({ id: "substring", name: "Pre alpha notes", updatedAt: 1 }),
      thread({ id: "fuzzy", name: "a-l-p-h-a", updatedAt: 100 }),
    ];

    expect(threadSearchMatches(threads, "alpha").map((match) => match.thread.id)).toEqual(["substring", "fuzzy"]);
  });

  it("keeps input order when search score and recency tie", () => {
    const threads = [thread({ id: "first", name: "Alpha" }), thread({ id: "second", name: "Alpha" })];

    expect(threadSearchMatches(threads, "alpha").map((match) => match.thread.id)).toEqual(["first", "second"]);
  });
});

function thread(options: Partial<Thread> & { id: string }): Thread {
  return {
    id: options.id,
    preview: options.preview ?? options.id,
    createdAt: options.createdAt ?? 1,
    updatedAt: options.updatedAt ?? 1,
    ...(options.recencyAt === undefined ? {} : { recencyAt: options.recencyAt }),
    name: options.name ?? null,
    archived: false,
    provenance: options.provenance ?? { kind: "interactive" },
  };
}
