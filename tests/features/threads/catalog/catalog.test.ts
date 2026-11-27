import { describe, expect, it, vi } from "vitest";
import { eventOrders } from "../../../support/async";
import { panelThreadFixture as thread } from "../../../support/panel-thread";
import { threadCatalogFixture } from "../../../support/thread-catalog";

describe("thread replacement publication", () => {
  it("publishes a replacement across active, archived, and search inventories while unrelated rows stay current", async () => {
    const source = thread({ id: "source", updatedAt: 5 });
    const replacement = thread({ id: "replacement", preview: "Resumed fork", updatedAt: 6 });
    const other = thread({ id: "other" });
    let active = [source];
    let archived: typeof active = [];
    const { catalog } = threadCatalogFixture(async (includeArchived) => (includeArchived ? archived : active));
    await Promise.all([catalog.fetchActiveThreads(), catalog.refreshArchivedThreads()]);
    const publication = catalog.beginReplacement(source.id);
    publication.attach({ ...replacement, preview: "" });
    catalog.facts.apply({ type: "thread-upserted", thread: replacement });
    const frames: { visible: readonly string[]; selected: string | null }[] = [];
    const stop = catalog.observeActiveThreadsResult(({ value }) => {
      const rows = value ?? [];
      const visible = rows.map(({ id }) => id).filter((id) => id === source.id || id === replacement.id);
      frames.push({ visible, selected: catalog.visibleThreadId(rows, replacement.id) });
    });
    active = [replacement, other];
    archived = [{ ...source, archived: true }];
    const search = catalog.watchActiveThreadSearch(vi.fn());
    await Promise.all([catalog.refreshActiveThreads(), catalog.refreshArchivedThreads()]);

    expect(catalog.recentActiveThreadsSnapshot()).toEqual([source, other]);
    expect(new Set(await catalog.fetchActiveThreadSearch())).toEqual(new Set([source, other]));
    expect(catalog.archivedThreadsSnapshot()).toEqual([]);
    expect(frames.at(-1)?.selected).toBe(source.id);

    publication.finish(true);
    catalog.facts.apply({ type: "thread-archived", threadId: source.id });
    expect(catalog.activeThreadsSnapshot()).toEqual([replacement, other]);
    expect(catalog.archivedThreadsSnapshot()).toEqual(archived);
    expect(new Set(await catalog.fetchActiveThreadSearch())).toEqual(new Set([replacement, other]));
    expect(frames.at(-1)?.selected).toBe(replacement.id);
    for (const { visible, selected } of frames) expect(visible).toEqual([selected]);
    search.close();
    stop();
  });

  it("publishes an archive accepted on retry before its notification arrives", async () => {
    const source = thread({ id: "source" });
    const child = thread({ id: "replacement" });
    let active = [source];
    const { catalog } = threadCatalogFixture(async () => active);
    await catalog.fetchActiveThreads();
    const replacement = catalog.beginReplacement(source.id);
    replacement.attach(child);
    replacement.finish(false);
    active = [child, source];
    const retry = catalog.beginReplacement(source.id, "retry");
    await catalog.refreshActiveThreads();
    expect(catalog.activeThreadsSnapshot()).toEqual([child, source]);
    retry.finish(true);
    expect(catalog.activeThreadsSnapshot()).toEqual([child]);
  });

  it("rejects overlap, publishes unrelated facts immediately, and releases a creation that did not start", async () => {
    const { catalog } = threadCatalogFixture(async () => [thread({ id: "source" }), thread({ id: "other" })]);
    await catalog.fetchActiveThreads();
    const replacement = catalog.beginReplacement("source");
    expect(() => catalog.beginReplacement("source")).toThrow("already in progress");
    catalog.facts.apply({ type: "thread-renamed", threadId: "other", name: "Other renamed" });
    catalog.facts.apply({ type: "thread-renamed", threadId: "source", name: "Source renamed" });
    expect(catalog.activeThreadsSnapshot()?.map((item) => item.name)).toEqual([null, "Other renamed"]);
    replacement.finish(false);
    expect(catalog.activeThreadsSnapshot()?.map((item) => item.name)).toEqual(["Source renamed", "Other renamed"]);
  });

  it("preserves observed source lifecycle order", async () => {
    const published = vi.fn();
    const { catalog } = threadCatalogFixture(async () => [], published);
    const replacement = catalog.beginReplacement("source");
    replacement.attach(thread({ id: "replacement" }));
    catalog.facts.apply({ type: "thread-archived", threadId: "source" });
    catalog.facts.apply({ type: "thread-unarchived", threadId: "source" });
    replacement.finish(true);
    expect(published).toHaveBeenCalledExactlyOnceWith([
      { type: "thread-upserted", thread: thread({ id: "replacement" }) },
      { type: "thread-archived", threadId: "source" },
      { type: "thread-unarchived", threadId: "source" },
    ]);
  });

  it("releases only the affected publication when a listener reenters the catalog", async () => {
    const published = vi.fn();
    let active = [thread({ id: "source" }), thread({ id: "other" })];
    const { catalog } = threadCatalogFixture(async () => active, published);
    await catalog.fetchActiveThreads();
    const first = catalog.beginReplacement("source");
    const second = catalog.beginReplacement("other");
    const replacement = thread({ id: "replacement" });
    const otherChild = thread({ id: "other-child" });
    active = [replacement, otherChild];
    first.attach(replacement);
    second.attach(otherChild);
    published.mockImplementationOnce(() => {
      first.finish(true);
      catalog.facts.apply({ type: "thread-renamed", threadId: "replacement", name: "Renamed" });
      catalog.facts.apply({ type: "thread-renamed", threadId: "other", name: "Other renamed" });
      expect(() => catalog.beginReplacement("source")).toThrow("already in progress");
    });

    first.finish(true);
    expect(catalog.activeThreadsSnapshot()?.find((item) => item.id === "replacement")?.name).toBe("Renamed");
    const otherRename = { type: "thread-renamed", threadId: "other", name: "Other renamed" };
    expect(published).not.toHaveBeenCalledWith(expect.arrayContaining([otherRename]));
    const search = catalog.watchActiveThreadSearch(vi.fn());
    expect((await catalog.fetchActiveThreadSearch()).map(({ id }) => id).sort()).toEqual(["other", "replacement"]);
    search.close();
    second.finish(false);
    expect(published).toHaveBeenLastCalledWith([{ type: "thread-upserted", thread: otherChild }, otherRename]);
  });

  it.each(eventOrders("finish-a", "finish-b", "rename-both"))(
    "publishes each replacement's rename only after its own release in $order",
    ({ order: schedule }) => {
      const renamed: string[] = [];
      const { catalog } = threadCatalogFixture(
        async () => [],
        (facts) => {
          for (const fact of facts) if (fact.type === "thread-renamed") renamed.push(fact.threadId);
        },
      );
      const a = catalog.beginReplacement("source-a");
      const b = catalog.beginReplacement("source-b");
      a.attach(thread({ id: "a" }));
      b.attach(thread({ id: "b" }));
      for (const [index, event] of schedule.entries()) {
        if (event === "finish-a") a.finish(false);
        else if (event === "finish-b") b.finish(false);
        else catalog.facts.applyBatch(["a", "b"].map((threadId) => ({ type: "thread-renamed", threadId, name: "Renamed" })));
        const seen = schedule.slice(0, index + 1);
        const expected = ["a", "b"].filter((id) => seen.includes("rename-both") && seen.includes(id === "a" ? "finish-a" : "finish-b"));
        expect([...renamed].sort()).toEqual(expected);
      }
    },
  );

  it("retires late facts and completion with its execution scope", () => {
    const published = vi.fn();
    const { catalog, scope } = threadCatalogFixture(async () => [], published);
    const replacement = catalog.beginReplacement("source");
    replacement.attach(thread({ id: "replacement" }));
    scope.dispose();
    expect(() => replacement.finish(true)).not.toThrow();
    catalog.facts.apply({ type: "thread-renamed", threadId: "replacement", name: "Late" });
    expect(published).not.toHaveBeenCalled();
    expect(catalog.activeThreadsSnapshot()).toBeNull();
  });
});
