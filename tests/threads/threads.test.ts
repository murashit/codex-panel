import { describe, expect, it } from "vitest";

import type { Thread } from "../../src/generated/app-server/v2/Thread";
import { codexPanelDisplayTitle, inheritedForkThreadName, upsertThread } from "../../src/domain/threads/model";

describe("thread helpers", () => {
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
    sessionId: "session-1",
    forkedFromId: null,
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
    turns: [],
    ...overrides,
  } as Thread;
}
