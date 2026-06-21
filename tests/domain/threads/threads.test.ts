import { describe, expect, it } from "vitest";

import {
  explicitThreadName,
  getThreadTitle,
  inheritedForkThreadName,
  normalizeExplicitThreadName,
  upsertThread,
  type Thread,
} from "../../../src/domain/threads/model";
import { threadArchiveDisplayTitle, threadRenameDraftTitle, threadUserTitle, threadWindowTitle } from "../../../src/domain/threads/title";

describe("thread helpers", () => {
  it("resolves display titles from explicit names, previews, then ids", () => {
    expect(getThreadTitle(thread({ name: "  Named   thread  ", preview: "Preview" }))).toBe("Named thread");
    expect(getThreadTitle(thread({ name: "  ", preview: "  Preview   only  " }))).toBe("Preview only");
    expect(getThreadTitle(thread({ id: "thread-id", name: null, preview: "" }))).toBe("thread-id");
  });

  it("keeps user-facing titles identifiable while keeping rename drafts human-authored", () => {
    const idOnly = thread({ id: "019e0182-cb70-7a72-ab48-8bc9d0b0d781", name: null, preview: "" });

    expect(threadUserTitle(idOnly)).toBe("019e0182-cb70-7a72-ab48-8bc9d0b0d781");
    expect(threadRenameDraftTitle(idOnly)).toBe("");
    expect(threadArchiveDisplayTitle(idOnly)).toBe("Untitled archived thread");
  });

  it("uses useful preview text instead of UUID-like names for draft and archive titles", () => {
    const uuidNamed = thread({
      id: "thread-id",
      name: "019e0182-cb70-7a72-ab48-8bc9d0b0d781",
      preview: "  Useful   preview  ",
    });

    expect(threadUserTitle(uuidNamed)).toBe("Useful preview");
    expect(threadRenameDraftTitle(uuidNamed)).toBe("Useful preview");
    expect(threadArchiveDisplayTitle(uuidNamed)).toBe("Useful preview");
  });

  it("builds window titles from loaded threads, restored titles, then short ids", () => {
    const uuid = "019e0182-cb70-7a72-ab48-8bc9d0b0d781";

    expect(threadWindowTitle(null, [])).toBe("Codex");
    expect(threadWindowTitle("thread", [thread({ id: "thread", name: "  Named   thread  " })])).toBe("Codex: Named thread");
    expect(threadWindowTitle("thread", [], "  Restored   title  ")).toBe("Codex: Restored title");
    expect(threadWindowTitle(uuid, [], null)).toBe("Codex: 019e0182");
  });

  it("inherits only explicit thread names for forked threads", () => {
    expect(inheritedForkThreadName("named", [thread({ id: "named", name: "親スレッド", preview: "Preview" })])).toBe("親スレッド");
    expect(inheritedForkThreadName("preview-only", [thread({ id: "preview-only", preview: "Preview" })])).toBeNull();
    expect(inheritedForkThreadName("blank-name", [thread({ id: "blank-name", name: "  ", preview: "Preview" })])).toBeNull();
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
});

function thread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "thread-1",
    preview: "",
    createdAt: 1,
    updatedAt: 1,
    name: null,
    archived: false,
    ...overrides,
  };
}
