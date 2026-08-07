import { describe, expect, it, vi } from "vitest";

import { createThreadAutoTitleWork } from "../../../../src/features/threads/workflows/thread-auto-title-work";
import type { ThreadMutationCommands } from "../../../../src/features/threads/workflows/thread-mutation-commands";
import { deferred } from "../../../support/async";

describe("thread auto-title work", () => {
  it("aborts in-flight generation when its execution runtime is disposed", async () => {
    const generation = deferred<string | null>();
    const fixture = workFixture(() => generation.promise);

    fixture.work.submit("thread", titleContext());
    await vi.waitFor(() => expect(fixture.generateTitle).toHaveBeenCalledOnce());
    const signal = fixture.generateTitle.mock.calls[0]?.[1];

    fixture.work.dispose();
    expect(signal?.aborted).toBe(true);
    generation.resolve("Stale title");
    await flushPromises();

    expect(fixture.renameThread).not.toHaveBeenCalled();
  });

  it("deduplicates the same thread across panel submissions", async () => {
    const fixture = workFixture(() => Promise.resolve("Generated title"));

    fixture.work.submit("thread", titleContext());
    fixture.work.submit("thread", titleContext());
    await vi.waitFor(() => expect(fixture.renameThread).toHaveBeenCalledOnce());

    expect(fixture.generateTitle).toHaveBeenCalledOnce();
    expect(fixture.renameThread).toHaveBeenCalledWith("thread", "Generated title", {
      shouldStart: expect.any(Function),
    });
  });

  it("lets a manual thread-name fact supersede pending generated work", async () => {
    const generation = deferred<string | null>();
    const fixture = workFixture(() => generation.promise);

    fixture.work.submit("thread", titleContext());
    await vi.waitFor(() => expect(fixture.generateTitle).toHaveBeenCalledOnce());
    fixture.work.applyThreadFact({ type: "thread-renamed", threadId: "thread", name: "Manual title" });
    generation.resolve("Generated title");
    await flushPromises();

    expect(fixture.renameThread).not.toHaveBeenCalled();
  });

  it("cancels pending generated work when the thread is archived", async () => {
    const generation = deferred<string | null>();
    const fixture = workFixture(() => generation.promise);

    fixture.work.submit("thread", titleContext());
    await vi.waitFor(() => expect(fixture.generateTitle).toHaveBeenCalledOnce());
    fixture.work.applyThreadFact({ type: "thread-archived", threadId: "thread" });
    generation.resolve("Generated title");
    await flushPromises();

    expect(fixture.renameThread).not.toHaveBeenCalled();
  });

  it("does not start work after a titled thread fact is observed", () => {
    const fixture = workFixture(() => Promise.resolve("Generated title"));

    fixture.work.applyThreadFact({
      type: "thread-upserted",
      thread: {
        id: "thread",
        preview: "Thread preview",
        name: "Existing title",
        archived: false,
        provenance: { kind: "interactive" },
        createdAt: 1,
        updatedAt: 1,
      },
    });
    fixture.work.submit("thread", titleContext());

    expect(fixture.generateTitle).not.toHaveBeenCalled();
  });

  it("ignores empty generated titles and generation failures", async () => {
    const empty = workFixture(() => Promise.resolve(""));
    empty.work.submit("thread", titleContext());
    await vi.waitFor(() => expect(empty.generateTitle).toHaveBeenCalledOnce());
    await flushPromises();
    expect(empty.renameThread).not.toHaveBeenCalled();

    const failed = workFixture(() => Promise.reject(new Error("unavailable")));
    failed.work.submit("thread", titleContext());
    await vi.waitFor(() => expect(failed.generateTitle).toHaveBeenCalledOnce());
    await flushPromises();
    expect(failed.renameThread).not.toHaveBeenCalled();
  });

  it("treats rename failures as best-effort work", async () => {
    const fixture = workFixture(() => Promise.resolve("Generated title"));
    fixture.renameThread.mockRejectedValueOnce(new Error("rename failed"));

    fixture.work.submit("thread", titleContext());
    await vi.waitFor(() => expect(fixture.renameThread).toHaveBeenCalledOnce());
    await flushPromises();
  });

  it("lets the shared rename owner recheck staleness before starting", async () => {
    const fixture = workFixture(() => Promise.resolve("Generated title"));
    fixture.renameThread.mockImplementationOnce(async (_threadId, _title, options) => {
      expect(options?.shouldStart?.()).toBe(true);
      return true;
    });

    fixture.work.submit("thread", titleContext());
    await vi.waitFor(() => expect(fixture.renameThread).toHaveBeenCalledOnce());
    await flushPromises();
  });
});

function workFixture(generate: () => Promise<string | null>) {
  const generateTitle = vi.fn((_context, _signal: AbortSignal) => generate());
  const renameThread = vi.fn<ThreadMutationCommands["renameThread"]>().mockResolvedValue(true);
  const work = createThreadAutoTitleWork({
    titlePort: {
      persistedContext: vi.fn().mockResolvedValue(null),
      generateTitle,
    },
    mutations: { renameThread },
  });
  return { work, generateTitle, renameThread };
}

function titleContext() {
  return {
    userRequest: "Name this thread.",
    assistantResponse: "Generated from its first completed turn.",
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
