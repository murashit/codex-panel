import { describe, expect, it } from "vitest";

import type { Thread } from "../../../src/generated/app-server/v2/Thread";
import {
  codexPanelDisplayTitle,
  explicitThreadName,
  getThreadTitle,
  inheritedForkThreadName,
  upsertThread,
} from "../../../src/domain/threads/model";

describe("thread helpers", () => {
  it("resolves display titles from explicit names, previews, then ids", () => {
    expect(getThreadTitle(thread({ name: "  Named   thread  ", preview: "Preview" }))).toBe("Named thread");
    expect(getThreadTitle(thread({ name: "  ", preview: "  Preview   only  " }))).toBe("Preview only");
    expect(getThreadTitle(thread({ id: "thread-id", name: null, preview: "" }))).toBe("thread-id");
  });

  it("formats Codex panel display titles from the active thread", () => {
    expect(codexPanelDisplayTitle(null, [])).toBe("Codex");
    expect(codexPanelDisplayTitle("thread-named", [thread({ id: "thread-named", name: "作業メモ" })])).toBe("Codex: 作業メモ");
    expect(codexPanelDisplayTitle("thread-preview", [thread({ id: "thread-preview", preview: "初回依頼" })])).toBe("Codex: 初回依頼");
    expect(codexPanelDisplayTitle("019e061e-0000-7000-8000-000000000001", [])).toBe("Codex: 019e061e");
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

  it("upserts resumed thread metadata without reordering existing rows", () => {
    const first = thread({ id: "first", preview: "old" });
    const second = thread({ id: "second" });
    const updated = thread({ id: "first", preview: "new", name: "Named" });

    expect(upsertThread([first, second], updated)).toEqual([{ ...first, ...updated }, second]);
    expect(upsertThread([second], first)).toEqual([first, second]);
  });
});

function thread(overrides: Partial<Thread & { archived: boolean }> = {}): Thread & { archived: boolean } {
  return {
    id: "thread-1",
    sessionId: "session-1",
    forkedFromId: null,
    parentThreadId: null,
    preview: "",
    ephemeral: false,
    modelProvider: "openai",
    createdAt: 1,
    updatedAt: 1,
    status: "idle",
    path: null,
    cwd: "/vault",
    cliVersion: "0.130.0",
    source: "appServer",
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    archived: false,
    turns: [],
    ...overrides,
  } as Thread & { archived: boolean };
}
