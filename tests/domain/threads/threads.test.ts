import { describe, expect, it } from "vitest";

import {
  explicitThreadName,
  getThreadTitle,
  inheritedForkThreadName,
  normalizeExplicitThreadName,
  upsertThread,
  type Thread,
} from "../../../src/domain/threads/model";

describe("thread helpers", () => {
  it("resolves display titles from explicit names, previews, then ids", () => {
    expect(getThreadTitle(thread({ name: "  Named   thread  ", preview: "Preview" }))).toBe("Named thread");
    expect(getThreadTitle(thread({ name: "  ", preview: "  Preview   only  " }))).toBe("Preview only");
    expect(getThreadTitle(thread({ id: "thread-id", name: null, preview: "" }))).toBe("thread-id");
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
