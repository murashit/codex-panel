import { describe, expect, it } from "vitest";

import type { Thread } from "../../../src/domain/threads/model";
import { threadRowCoreProjection } from "../../../src/features/threads/row-projection";

describe("thread row core projection", () => {
  it("projects shared row title, selection, rename, and archive confirmation state", () => {
    const row = threadRowCoreProjection({
      thread: thread({ name: "  Saved   name  ", preview: "Preview" }),
      selected: true,
      renameState: { kind: "generating", draft: "Draft", originalDraft: "Saved name", generationToken: 1 },
      archiveConfirmActive: true,
      defaultArchiveSaveMarkdown: true,
    });

    expect(row).toMatchObject({
      threadId: "thread",
      title: "Saved name",
      selected: true,
      rename: { active: true, draft: "Draft", generating: true },
      archiveConfirm: { active: true, defaultSaveMarkdown: true },
    });
  });

  it("uses the normalized thread title as the inactive rename draft", () => {
    expect(threadRowCoreProjection({ thread: thread({ name: "  ", preview: "Preview title" }), selected: false }).rename).toEqual({
      active: false,
      draft: "Preview title",
      generating: false,
    });
    expect(threadRowCoreProjection({ thread: thread({ name: null, preview: "" }), selected: false }).rename.draft).toBe("");
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
