import { describe, expect, it, vi } from "vitest";
import type { ThreadRenameActiveState } from "../../../../src/domain/threads/rename-lifecycle";
import { createThreadRenameEditor, type ThreadRenameEditorHost } from "../../../../src/features/threads/workflows/thread-rename-editor";
import { deferred } from "../../../support/async";

describe("thread rename editor", () => {
  it("keeps independent thread-list editors concurrent", async () => {
    const readyContext = { userRequest: "First request", assistantResponse: "First response" };
    const firstContext = deferred<typeof readyContext>();
    const secondContext = deferred<null>();
    const { editor, states } = fixture({
      resolveTitleContext: vi.fn((threadId) => (threadId === "first" ? firstContext.promise : secondContext.promise)),
    });

    editor.start("first");
    editor.start("second");

    expect(states.get("first")?.kind).toBe("editing");
    expect(states.get("second")?.kind).toBe("editing");
    firstContext.resolve(readyContext);
    secondContext.resolve(null);
    await flushPromises();

    expect(states.get("first")).toMatchObject({ kind: "editing", autoName: { kind: "ready", context: readyContext } });
    expect(states.get("second")).toMatchObject({ kind: "editing", autoName: { kind: "unavailable" } });
  });

  it("aborts replaced title work for an exclusive chat editor", async () => {
    const generated = deferred<string>();
    let signal: AbortSignal | undefined;
    const { editor, states } = fixture({
      exclusive: true,
      resolveTitleContext: vi.fn().mockResolvedValue({ userRequest: "Request", assistantResponse: "Response" }),
      generateTitle: vi.fn((_context, generationSignal) => {
        signal = generationSignal;
        return generated.promise;
      }),
    });

    editor.start("first");
    await flushPromises();
    const generation = editor.autoNameDraft("first");
    await flushPromises();
    editor.start("second");

    expect(signal?.aborted).toBe(true);
    expect(states.has("first")).toBe(false);
    expect(states.get("second")?.kind).toBe("editing");
    generated.resolve("Stale title");
    await generation;
  });

  it("does not replace an active title generation", async () => {
    const generated = deferred<string>();
    const generateTitle = vi.fn(() => generated.promise);
    const { editor } = fixture({
      resolveTitleContext: vi.fn().mockResolvedValue({ userRequest: "Request", assistantResponse: "Response" }),
      generateTitle,
    });

    editor.start("thread");
    await flushPromises();
    const generation = editor.autoNameDraft("thread");
    await flushPromises();
    await editor.autoNameDraft("thread");

    expect(generateTitle).toHaveBeenCalledOnce();
    generated.resolve("Title");
    await generation;
  });

  it("ignores a generated title after the same list editor restarts", async () => {
    const generated = deferred<string>();
    const { editor, states } = fixture({
      resolveTitleContext: vi.fn().mockResolvedValue({ userRequest: "Request", assistantResponse: "Response" }),
      generateTitle: vi.fn(() => generated.promise),
    });

    editor.start("thread");
    await flushPromises();
    const generation = editor.autoNameDraft("thread");
    await flushPromises();
    editor.start("thread");
    generated.resolve("Stale title");
    await generation;

    expect(states.get("thread")?.draft).toBe("thread draft");
  });

  it("does not replace an exclusive editor while another thread save is pending", async () => {
    const saved = deferred<void>();
    const { editor, states } = fixture({ exclusive: true, renameThread: vi.fn(() => saved.promise) });

    editor.start("first");
    const save = editor.save("first", "Saved title");
    editor.start("second");

    expect(states.get("first")?.kind).toBe("saving");
    expect(states.has("second")).toBe(false);
    saved.resolve();
    await save;
  });

  it("releases an exclusive save after its externally owned state is replaced", async () => {
    const saved = deferred<void>();
    const { editor, states } = fixture({ exclusive: true, renameThread: vi.fn(() => saved.promise) });

    editor.start("first");
    const save = editor.save("first", "Stale title");
    states.delete("first");
    saved.resolve();
    await save;
    editor.start("second");

    expect(states.get("second")?.kind).toBe("editing");
  });
});

function fixture(overrides: Partial<ThreadRenameEditorHost> = {}) {
  const states = new Map<string, ThreadRenameActiveState>();
  const host: ThreadRenameEditorHost = {
    state: {
      get: (threadId) => states.get(threadId),
      replace: (threadId, state) => {
        if (overrides.exclusive && state?.kind === "editing" && !states.has(threadId)) states.clear();
        if (state) states.set(threadId, state);
        else states.delete(threadId);
      },
      clear: () => states.clear(),
    },
    initialDraft: (threadId) => `${threadId} draft`,
    renameThread: vi.fn().mockResolvedValue(true),
    resolveTitleContext: vi.fn().mockResolvedValue(null),
    generateTitle: vi.fn().mockResolvedValue("Generated"),
    reportError: vi.fn(),
    ...overrides,
  };
  return { editor: createThreadRenameEditor(host), states };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
