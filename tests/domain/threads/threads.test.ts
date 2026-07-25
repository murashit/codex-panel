import { describe, expect, it } from "vitest";

import {
  explicitThreadName,
  normalizeExplicitThreadName,
  type Thread,
  threadRecencyAt,
  upsertThread,
} from "../../../src/domain/threads/model";
import { threadDisplayTitle, threadMeaningfulTitle, threadRenameDraftTitle, threadWindowTitle } from "../../../src/domain/threads/title";

describe("thread helpers", () => {
  it("resolves meaningful titles from explicit names, then previews, without id fallbacks", () => {
    expect(threadMeaningfulTitle(thread({ name: "  Named   thread  ", preview: "Preview" }))).toBe("Named thread");
    expect(threadMeaningfulTitle(thread({ name: "  ", preview: "  Preview   only  " }))).toBe("Preview only");
    expect(threadMeaningfulTitle(thread({ id: "thread-id", name: null, preview: "" }))).toBeNull();
  });

  it("keeps user-facing placeholders separate from rename drafts", () => {
    const idOnly = thread({ id: "019e0182-cb70-7a72-ab48-8bc9d0b0d781", name: null, preview: "" });

    expect(threadDisplayTitle(idOnly)).toBe("Untitled thread");
    expect(threadRenameDraftTitle(idOnly)).toBe("");
  });

  it("uses useful preview text instead of UUID-like names", () => {
    const uuidNamed = thread({
      id: "thread-id",
      name: "019e0182-cb70-7a72-ab48-8bc9d0b0d781",
      preview: "  Useful   preview  ",
    });

    expect(threadDisplayTitle(uuidNamed)).toBe("Useful preview");
    expect(threadRenameDraftTitle(uuidNamed)).toBe("Useful preview");
  });

  it("builds window titles from loaded threads, restored titles, then short ids", () => {
    const uuid = "019e0182-cb70-7a72-ab48-8bc9d0b0d781";

    expect(threadWindowTitle(null, [])).toBe("Codex");
    expect(threadWindowTitle("thread", [thread({ id: "thread", name: "  Named   thread  " })])).toBe("Codex: Named thread");
    expect(threadWindowTitle("thread", [], "  Restored   title  ")).toBe("Codex: Restored title");
    expect(threadWindowTitle(uuid, [thread({ id: uuid, name: null, preview: "" })])).toBe("Codex: 019e0182");
    expect(threadWindowTitle(uuid, [], null)).toBe("Codex: 019e0182");
  });

  it("resolves only explicit thread names for composer context", () => {
    expect(explicitThreadName(thread({ name: "  Refactor   terminal streaming  ", preview: "Preview" }))).toBe(
      "Refactor terminal streaming",
    );
    expect(explicitThreadName(thread({ name: "  ", preview: "Preview" }))).toBeNull();
    expect(explicitThreadName(thread({ name: null, preview: "Preview" }))).toBeNull();
    expect(explicitThreadName(thread({ name: null, preview: "", id: "thread-id" }))).toBeNull();
  });

  it("normalizes explicit thread name values", () => {
    expect(normalizeExplicitThreadName("  Rename   thread  ")).toBe("Rename thread");
    expect(normalizeExplicitThreadName("  ")).toBeNull();
    expect(normalizeExplicitThreadName(null)).toBeNull();
    expect(normalizeExplicitThreadName(undefined)).toBeNull();
  });

  it("upserts resumed thread metadata without reordering existing rows", () => {
    const first = thread({ id: "first", preview: "old" });
    const second = thread({ id: "second" });
    const updated = thread({ id: "first", preview: "new", name: "Named" });

    expect(upsertThread([first, second], updated)).toEqual([{ ...first, ...updated }, second]);
    expect(upsertThread([second], first)).toEqual([first, second]);
  });

  it("uses recency timestamps when present and clears them when app-server sends null", () => {
    const recent = thread({ updatedAt: 10, recencyAt: 30 });
    const cleared = thread({ updatedAt: 20, recencyAt: null });

    expect(threadRecencyAt(recent)).toBe(30);
    expect(threadRecencyAt(cleared)).toBe(20);
    expect(upsertThread([recent], cleared)[0]?.recencyAt).toBeNull();
  });
});

function thread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "thread-1",
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
