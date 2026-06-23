import { describe, expect, it } from "vitest";

import type { Thread } from "../../../src/domain/threads/model";
import { threadRows, transitionThreadsRenameState, type ThreadsRenameState } from "../../../src/features/threads-view/state";
import type { OpenCodexPanelSnapshot } from "../../../src/workspace/panel-coordinator";

describe("threads view rename state", () => {
  it("keeps a late auto-name result from reviving a cancelled rename", () => {
    const generating = generatingRenameState("Original draft", 1);

    expect(
      transitionThreadsRenameState(undefined, { type: "auto-name-generated", generatingState: generating, title: "Late title" }),
    ).toBeUndefined();
    expect(transitionThreadsRenameState(undefined, { type: "auto-name-finished", generatingState: generating })).toBeUndefined();
  });

  it("keeps a manually edited draft when auto-name finishes later", () => {
    const generating = generatingRenameState("Original draft", 1);

    const manuallyEdited = transitionThreadsRenameState(generating, { type: "draft-updated", draft: "Manual draft" });

    expect(
      transitionThreadsRenameState(manuallyEdited, { type: "auto-name-generated", generatingState: generating, title: "Late title" }),
    ).toBe(manuallyEdited);
    expect(transitionThreadsRenameState(manuallyEdited, { type: "auto-name-finished", generatingState: generating })).toEqual({
      kind: "editing",
      draft: "Manual draft",
    });
  });

  it("applies generated titles only to the active unchanged generation", () => {
    const generating = generatingRenameState("Original draft", 1);

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
  });

  it("keeps ignored rename lifecycle transitions as no-ops", () => {
    const editing = editingRenameState("Original draft");
    const generating = generatingRenameState("Original draft", 1);

    expect(transitionThreadsRenameState(undefined, { type: "draft-updated", draft: "Stray" })).toBeUndefined();
    expect(transitionThreadsRenameState(undefined, { type: "auto-name-started", generationToken: 1 })).toBeUndefined();
    expect(transitionThreadsRenameState(editing, { type: "auto-name-generated", generatingState: generating, title: "Late" })).toBe(
      editing,
    );
    expect(transitionThreadsRenameState(generating, { type: "auto-name-started", generationToken: 2 })).toBe(generating);
  });

  it("keeps stale auto-name completion from finishing a newer generation", () => {
    const oldGenerating = generatingRenameState("Original draft", 1);
    const currentGenerating = generatingRenameState("Original draft", 2);

    expect(
      transitionThreadsRenameState(currentGenerating, { type: "auto-name-generated", generatingState: oldGenerating, title: "Old" }),
    ).toBe(currentGenerating);
    expect(transitionThreadsRenameState(currentGenerating, { type: "auto-name-finished", generatingState: oldGenerating })).toBe(
      currentGenerating,
    );
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

function editingRenameState(draft: string): ThreadsRenameState {
  return expectRenameState(transitionThreadsRenameState(undefined, { type: "started", draft }));
}

function generatingRenameState(draft: string, generationToken: number): Extract<ThreadsRenameState, { kind: "generating" }> {
  const editing = editingRenameState(draft);
  const generating = transitionThreadsRenameState(editing, { type: "auto-name-started", generationToken });
  if (generating?.kind !== "generating") throw new Error("Expected generating state");
  return generating;
}

function expectRenameState(state: ThreadsRenameState | undefined): ThreadsRenameState {
  if (state) return state;
  throw new Error("Expected rename state");
}

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
