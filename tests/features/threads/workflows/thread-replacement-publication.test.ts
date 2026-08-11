import { describe, expect, it, vi } from "vitest";

import { applyThreadCatalogChange } from "../../../../src/domain/threads/catalog-read-model";
import type { Thread } from "../../../../src/domain/threads/model";
import { projectThreadFacts } from "../../../../src/features/threads/workflows/thread-projection";
import { createThreadReplacementPublication } from "../../../../src/features/threads/workflows/thread-replacement-publication";

describe("thread replacement visibility", () => {
  it("never exposes both source and replacement in the active Threads view when replacement succeeds", () => {
    const catalog = visibleCatalogPublication();

    const replacement = catalog.publication.begin("source");
    replacement.attach(thread("replacement", { preview: "fork response" }));
    catalog.publication.facts.apply({ type: "thread-upserted", thread: thread("replacement", { preview: "resumed" }) });
    catalog.publication.facts.apply({ type: "thread-archived", threadId: "source" });

    expect(catalog.visibleActiveSnapshots).toEqual([]);

    replacement.finish(true);

    expect(catalog.visibleActiveSnapshots).toEqual([["replacement", "other"]]);
    expect(catalog.active()).toEqual([thread("replacement", { preview: "resumed" }), thread("other")]);
    expect(catalog.archived()).toEqual([thread("source", { archived: true })]);
  });

  it("publishes only the replacement when source archiving fails", () => {
    const committed: unknown[] = [];
    const publication = createThreadReplacementPublication((facts) => committed.push(facts));
    const replacement = publication.begin("source");
    replacement.attach(thread("replacement"));

    replacement.finish(false);

    expect(committed).toEqual([[{ type: "thread-upserted", thread: thread("replacement") }]]);
  });

  it("publishes source facts and releases visibility when replacement creation does not start", () => {
    const commit = vi.fn();
    const release = vi.fn();
    const publication = createThreadReplacementPublication(commit, () => release);
    const replacement = publication.begin("source");
    publication.facts.apply({ type: "thread-renamed", threadId: "source", name: "Renamed" });

    replacement.finish(false);

    expect(commit).toHaveBeenCalledWith([{ type: "thread-renamed", threadId: "source", name: "Renamed" }]);
    expect(release).toHaveBeenCalledOnce();
  });

  it("keeps the source hidden when its archive notification arrives after a successful replacement", () => {
    const catalog = visibleCatalogPublication();
    const replacement = catalog.publication.begin("source");
    replacement.attach(thread("replacement"));

    replacement.finish(true);
    catalog.publication.facts.apply({ type: "thread-archived", threadId: "source" });

    expect(catalog.visibleActiveSnapshots).toEqual([
      ["replacement", "other"],
      ["replacement", "other"],
    ]);
  });

  it("rejects overlapping publications without disturbing the active publication", () => {
    const committed: unknown[] = [];
    const publication = createThreadReplacementPublication((facts) => committed.push(facts));
    const active = publication.begin("source");
    active.attach(thread("replacement"));

    expect(() => publication.begin("source")).toThrow("already in progress");

    active.finish(false);
    expect(committed).toEqual([[{ type: "thread-upserted", thread: thread("replacement") }]]);
  });

  it("does not delay facts for unrelated threads", () => {
    const committed: unknown[] = [];
    const publication = createThreadReplacementPublication((facts) => committed.push(facts));
    const replacement = publication.begin("source");
    replacement.attach(thread("replacement"));

    publication.facts.apply({ type: "thread-renamed", threadId: "unrelated", name: "Updated" });

    expect(committed).toEqual([[{ type: "thread-renamed", threadId: "unrelated", name: "Updated" }]]);
    replacement.finish(false);
  });

  it("keeps a source archive observed before replacement publication finishes", () => {
    const committed: unknown[] = [];
    const publication = createThreadReplacementPublication((facts) => committed.push(facts));
    const replacement = publication.begin("source");
    replacement.attach(thread("replacement"));
    publication.facts.apply({ type: "thread-archived", threadId: "source" });

    replacement.finish(true);

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
    const replacement = publication.begin("source");
    replacement.attach(thread("replacement"));
    publication.facts.apply({ type: "thread-archived", threadId: "source" });
    publication.facts.apply({ type: "thread-unarchived", threadId: "source" });

    replacement.finish(true);

    expect(committed).toEqual([
      [
        { type: "thread-upserted", thread: thread("replacement") },
        { type: "thread-archived", threadId: "source" },
        { type: "thread-unarchived", threadId: "source" },
      ],
    ]);
  });
});

function visibleCatalogPublication(): {
  publication: ReturnType<typeof createThreadReplacementPublication>;
  visibleActiveSnapshots: string[][];
  active: () => readonly Thread[] | null;
  archived: () => readonly Thread[] | null;
} {
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
  return { publication, visibleActiveSnapshots, active: () => active, archived: () => archived };
}

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
