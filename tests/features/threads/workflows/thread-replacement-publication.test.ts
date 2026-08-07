import { describe, expect, it } from "vitest";

import { applyThreadCatalogChange } from "../../../../src/domain/threads/catalog-read-model";
import type { Thread } from "../../../../src/domain/threads/model";
import { projectThreadFacts } from "../../../../src/features/threads/workflows/thread-projection";
import { createThreadReplacementPublication } from "../../../../src/features/threads/workflows/thread-replacement-publication";

describe("ThreadReplacementPublication", () => {
  it("publishes replacement resume and source archive as one visible catalog change", () => {
    let active: readonly Thread[] | null = [thread("source"), thread("other")];
    let archived: readonly Thread[] | null = [];
    const visibleActiveSnapshots: string[][] = [];
    const publication = createThreadReplacementPublication((facts) => {
      const changes = projectThreadFacts(
        {
          activeThreadsSnapshot: () => active,
          archivedThreadsSnapshot: () => archived,
        },
        facts,
      );
      for (const change of changes) {
        if (change.list === "active") active = applyThreadCatalogChange(active, change);
        else archived = applyThreadCatalogChange(archived, change);
      }
      visibleActiveSnapshots.push(active?.map((item) => item.id) ?? []);
    });

    const replacement = publication.begin("source", thread("replacement", { preview: "fork response" }));
    publication.facts.apply({ type: "thread-upserted", thread: thread("replacement", { preview: "resumed" }) });
    publication.facts.apply({ type: "thread-archived", threadId: "source" });

    expect(visibleActiveSnapshots).toEqual([]);

    replacement.finish();

    expect(visibleActiveSnapshots).toEqual([["replacement", "other"]]);
    expect(active).toEqual([thread("replacement", { preview: "resumed" }), thread("other")]);
    expect(archived).toEqual([thread("source", { archived: true })]);
  });

  it("publishes only the replacement when source archiving fails", () => {
    const committed: unknown[] = [];
    const publication = createThreadReplacementPublication((facts) => committed.push(facts));
    const replacement = publication.begin("source", thread("replacement"));

    replacement.finish();

    expect(committed).toEqual([[{ type: "thread-upserted", thread: thread("replacement") }]]);
  });

  it("publishes a later source archive notification exactly once", () => {
    const committed: unknown[] = [];
    const publication = createThreadReplacementPublication((facts) => committed.push(facts));
    const replacement = publication.begin("source", thread("replacement"));

    replacement.finish();
    publication.facts.apply({ type: "thread-archived", threadId: "source" });

    expect(committed).toEqual([
      [{ type: "thread-upserted", thread: thread("replacement") }],
      [{ type: "thread-archived", threadId: "source" }],
    ]);
  });

  it("rejects overlapping publications without disturbing the active publication", () => {
    const committed: unknown[] = [];
    const publication = createThreadReplacementPublication((facts) => committed.push(facts));
    const active = publication.begin("source", thread("replacement"));

    expect(() => publication.begin("source", thread("other"))).toThrow("already in progress");

    active.finish();
    expect(committed).toEqual([[{ type: "thread-upserted", thread: thread("replacement") }]]);
  });

  it("does not delay facts for unrelated threads", () => {
    const committed: unknown[] = [];
    const publication = createThreadReplacementPublication((facts) => committed.push(facts));
    const replacement = publication.begin("source", thread("replacement"));

    publication.facts.apply({ type: "thread-renamed", threadId: "unrelated", name: "Updated" });

    expect(committed).toEqual([[{ type: "thread-renamed", threadId: "unrelated", name: "Updated" }]]);
    replacement.finish();
  });

  it("keeps a source archive observed before replacement publication finishes", () => {
    const committed: unknown[] = [];
    const publication = createThreadReplacementPublication((facts) => committed.push(facts));
    const replacement = publication.begin("source", thread("replacement"));
    publication.facts.apply({ type: "thread-archived", threadId: "source" });

    replacement.finish();

    expect(committed).toEqual([
      [
        { type: "thread-upserted", thread: thread("replacement") },
        { type: "thread-archived", threadId: "source" },
      ],
    ]);
  });

  it("preserves observed source lifecycle order", () => {
    const committed: unknown[] = [];
    const publication = createThreadReplacementPublication((facts) => committed.push(facts));
    const replacement = publication.begin("source", thread("replacement"));
    publication.facts.apply({ type: "thread-archived", threadId: "source" });
    publication.facts.apply({ type: "thread-unarchived", threadId: "source" });

    replacement.finish();

    expect(committed).toEqual([
      [
        { type: "thread-upserted", thread: thread("replacement") },
        { type: "thread-archived", threadId: "source" },
        { type: "thread-unarchived", threadId: "source" },
      ],
    ]);
  });
});

function thread(id: string, overrides: Partial<Thread> = {}): Thread {
  return {
    id,
    preview: "",
    createdAt: 1,
    updatedAt: 1,
    name: null,
    archived: false,
    canAcceptDirectInput: null,
    provenance: { kind: "interactive" },
    ...overrides,
  };
}
