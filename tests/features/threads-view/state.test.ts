import { describe, expect, it } from "vitest";

import type { Thread } from "../../../src/domain/threads/model";
import { threadRows, transitionThreadsRenameState } from "../../../src/features/threads-view/state";
import type { OpenCodexPanelSnapshot } from "../../../src/workspace/panel-coordinator";

describe("threads view rename state", () => {
  it("maps threads view auto-name events through the shared rename lifecycle", () => {
    const editing = transitionThreadsRenameState(undefined, { type: "started", draft: "Original draft" });
    const generating = transitionThreadsRenameState(editing, { type: "auto-name-started", generationToken: 1 });
    if (generating?.kind !== "generating") throw new Error("Expected generating state");

    const generated = transitionThreadsRenameState(generating, {
      type: "auto-name-generated",
      generatingState: generating,
      title: "Generated title",
    });

    expect(generated).toEqual({
      kind: "generating",
      draft: "Generated title",
      originalDraft: "Original draft",
      generationToken: 1,
    });
    expect(transitionThreadsRenameState(generated, { type: "auto-name-finished", generatingState: generating })).toEqual({
      kind: "editing",
      draft: "Generated title",
    });
    expect(transitionThreadsRenameState(generated, { type: "cancelled" })).toBeUndefined();
    expect(transitionThreadsRenameState(undefined, { type: "draft-updated", draft: "Stray" })).toBeUndefined();
  });

  it("initializes rename drafts from normalized explicit thread names", () => {
    expect(threadRows([thread({ name: "  Saved   name  ", preview: "Preview" })], [], new Map())[0]?.rename.draft).toBe("Saved name");
    expect(threadRows([thread({ name: "  ", preview: "Preview title" })], [], new Map())[0]?.rename.draft).toBe("Preview title");
    expect(threadRows([thread({ name: null, preview: "" })], [], new Map())[0]?.rename.draft).toBe("");
  });

  it("orders rows by thread recency when available", () => {
    const rows = threadRows(
      [thread({ id: "updated-newer", updatedAt: 20, recencyAt: 10 }), thread({ id: "recent", updatedAt: 10, recencyAt: 30 })],
      [],
      new Map(),
    );

    expect(rows.map((row) => row.threadId)).toEqual(["recent", "updated-newer"]);
  });

  it("treats pending MCP elicitations as pending live state", () => {
    const rows = threadRows([thread()], [openPanelSnapshot({ pendingMcpElicitations: 1 })], new Map());

    expect(rows[0]?.live).toMatchObject({ status: "pending" });
  });
});

function thread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "thread",
    preview: "",
    name: null,
    archived: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function openPanelSnapshot(overrides: Partial<OpenCodexPanelSnapshot> = {}): OpenCodexPanelSnapshot {
  return {
    viewId: "view",
    threadId: "thread",
    turnLifecycle: { kind: "idle" },
    pendingApprovals: 0,
    pendingUserInputs: 0,
    pendingMcpElicitations: 0,
    hasComposerDraft: false,
    connected: true,
    lastFocused: false,
    ...overrides,
  };
}
