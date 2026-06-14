import { describe, expect, it } from "vitest";

import type { Thread } from "../../../../src/domain/threads/model";
import { codexPanelDisplayTitle } from "../../../../src/features/chat/application/threads/title-display";

describe("chat thread title display", () => {
  it("formats Codex panel display titles from the active thread", () => {
    expect(codexPanelDisplayTitle(null, [])).toBe("Codex");
    expect(codexPanelDisplayTitle("thread-named", [thread({ id: "thread-named", name: "作業メモ" })])).toBe("Codex: 作業メモ");
    expect(codexPanelDisplayTitle("thread-preview", [thread({ id: "thread-preview", preview: "初回依頼" })])).toBe("Codex: 初回依頼");
    expect(codexPanelDisplayTitle("019e061e-0000-7000-8000-000000000001", [])).toBe("Codex: 019e061e");
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
