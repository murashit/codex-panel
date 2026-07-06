import { describe, expect, it } from "vitest";

import type { Thread } from "../../../src/domain/threads/model";
import { resolveThreadSearchQuery, threadSearchMatches } from "../../../src/domain/threads/search";

describe("thread search", () => {
  it("ranks exact ids, title prefixes, id prefixes, title includes, and recency consistently", () => {
    const threads = [
      thread({ id: "thread-alpha", name: "Older Alpha", updatedAt: 10 }),
      thread({ id: "thread-beta", name: "Recent unrelated alpha mention", updatedAt: 30 }),
      thread({ id: "alpha-thread", name: "Newest unrelated", updatedAt: 40 }),
      thread({ id: "thread-title", name: "Alpha starts", updatedAt: 5 }),
    ];

    expect(threadSearchMatches(threads, "alpha").map((match) => match.thread.id)).toEqual([
      "thread-title",
      "alpha-thread",
      "thread-beta",
      "thread-alpha",
    ]);
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

  it("ranks exact full ids and short ids before title prefixes", () => {
    const threads = [
      thread({ id: "019abcde-0000-7000-8000-000000000001", name: "Project notes" }),
      thread({ id: "thread-other", name: "019abcde planning" }),
    ];

    expect(threadSearchMatches(threads, "019abcde").map((match) => match.thread.id)).toEqual([
      "019abcde-0000-7000-8000-000000000001",
      "thread-other",
    ]);
    expect(threadSearchMatches(threads, "019abcde-0000-7000-8000-000000000001")[0]?.thread.id).toBe("019abcde-0000-7000-8000-000000000001");
  });

  it("uses recency for empty searches", () => {
    expect(
      threadSearchMatches(
        [thread({ id: "updated-newer", updatedAt: 20, recencyAt: 10 }), thread({ id: "recent", updatedAt: 10, recencyAt: 30 })],
        "",
      ).map((match) => match.thread.id),
    ).toEqual(["recent", "updated-newer"]);
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
  };
}
