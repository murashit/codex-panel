import { describe, expect, it, vi } from "vitest";
import { panelThreadFixture as thread } from "../../../support/panel-thread";
import { threadCatalogFixture } from "../../../support/thread-catalog";

describe("thread replacement publication", () => {
  it("keeps the old row and activity until a single replacement snapshot, including refresh and late notification", async () => {
    let server = [thread({ id: "source" }), thread({ id: "other" })];
    const read = vi.fn(async (archived: boolean) => (archived ? [] : server));
    const { catalog } = threadCatalogFixture(read);
    await Promise.all([catalog.fetchActiveThreads(), catalog.refreshArchivedThreads()]);
    let actualThreadId = "source";
    const frames: { ids: string[]; selected: string | null }[] = [];
    const capture = (threads = catalog.activeThreadsSnapshot() ?? []) => {
      frames.push({ ids: threads.map((item) => item.id), selected: catalog.visibleThreadId(threads, actualThreadId) });
    };
    catalog.observeActiveThreadsResult((result) => capture(result.value ?? []));
    const replacement = catalog.beginReplacement("source");
    const readsBefore = read.mock.calls.length;
    await catalog.refreshActiveThreads();
    expect(read).toHaveBeenCalledTimes(readsBefore);
    replacement.attach(thread({ id: "replacement" }));
    actualThreadId = "replacement";
    capture();
    catalog.facts.apply({ type: "thread-upserted", thread: thread({ id: "replacement", preview: "resumed" }) });
    catalog.facts.apply({ type: "thread-archived", threadId: "source" });
    expect(frames.every((frame) => frame.selected === "source")).toBe(true);
    server = [thread({ id: "replacement", preview: "resumed" }), thread({ id: "other" })];
    replacement.finish(true);
    await vi.waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(readsBefore));
    catalog.facts.apply({ type: "thread-archived", threadId: "source" });
    for (const frame of frames) {
      expect(frame.ids).toEqual(frame.selected === "source" ? ["source", "other"] : ["replacement", "other"]);
      expect(frame.ids).toContain(frame.selected);
    }
    expect(frames.at(-1)?.selected).toBe("replacement");
    expect(catalog.archivedThreadsSnapshot()).toEqual([thread({ id: "source", archived: true })]);
  });

  it("publishes an archive accepted on retry before its notification arrives", async () => {
    const { catalog } = threadCatalogFixture(async () => []);
    await catalog.fetchActiveThreads();
    catalog.facts.apply({ type: "thread-upserted", thread: thread({ id: "source" }) });
    const replacement = catalog.beginReplacement("source");
    replacement.attach(thread({ id: "replacement" }));
    replacement.finish(false);
    expect(catalog.activeThreadsSnapshot()?.map((item) => item.id)).toEqual(["replacement", "source"]);
    const retry = catalog.beginReplacement("source");
    retry.finish(true);
    expect(catalog.activeThreadsSnapshot()?.map((item) => item.id)).toEqual(["replacement"]);
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

  it("keeps reads blocked through reentrant publication and overlapping independent replacements", async () => {
    const read = vi.fn(async () => []);
    const published = vi.fn();
    const { catalog } = threadCatalogFixture(read, published);
    await catalog.fetchActiveThreads();
    read.mockClear();
    const first = catalog.beginReplacement("source");
    const second = catalog.beginReplacement("other");
    first.attach(thread({ id: "replacement" }));
    published.mockImplementationOnce(() => {
      first.finish(true);
      catalog.facts.apply({ type: "thread-renamed", threadId: "replacement", name: "Renamed" });
      catalog.facts.apply({ type: "thread-renamed", threadId: "other", name: "Other renamed" });
      void catalog.refreshActiveThreads();
      expect(() => catalog.beginReplacement("source")).toThrow("already in progress");
    });
    first.finish(true);
    expect(read).not.toHaveBeenCalled();
    expect(catalog.activeThreadsSnapshot()?.find((item) => item.id === "replacement")?.name).toBe("Renamed");
    expect(published).not.toHaveBeenCalledWith([{ type: "thread-renamed", threadId: "other", name: "Other renamed" }]);
    second.finish(false);
    await vi.waitFor(() => expect(read).toHaveBeenCalled());
    expect(published).toHaveBeenCalledWith([{ type: "thread-renamed", threadId: "other", name: "Other renamed" }]);
  });

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
