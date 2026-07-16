import { describe, expect, it } from "vitest";

import type { Thread } from "../../../src/domain/threads/model";
import { type ThreadsViewPanelActivity, threadRows, transitionThreadsRenameState } from "../../../src/features/threads-view/state";

describe("threads view rename state", () => {
  it("keeps auto-name results scoped to the active unchanged generation", () => {
    const editing = transitionThreadsRenameState(undefined, { type: "started", draft: "Original draft" });
    const generating = transitionThreadsRenameState(editing, { type: "generation-started", generationToken: 1 });
    if (generating?.kind !== "generating") throw new Error("Expected generating state");

    const generated = transitionThreadsRenameState(generating, {
      type: "generation-succeeded",
      generationToken: generating.generationToken,
      draft: "Generated title",
    });

    expect(generated).toEqual({
      kind: "generating",
      draft: "Generated title",
      originalDraft: "Original draft",
      generationToken: 1,
    });
    expect(transitionThreadsRenameState(generated, { type: "generation-finished", generationToken: generating.generationToken })).toEqual({
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
    const rows = threadRows([thread()], [panelActivity({ pending: true })], new Map());

    expect(rows[0]?.live).toMatchObject({ status: "pending" });
  });
});

function thread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "thread",
    preview: "",
    name: null,
    archived: false,
    provenance: { kind: "interactive" },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function panelActivity(overrides: Partial<ThreadsViewPanelActivity> = {}): ThreadsViewPanelActivity {
  return {
    threadId: "thread",
    selected: false,
    pending: false,
    running: false,
    ...overrides,
  };
}
