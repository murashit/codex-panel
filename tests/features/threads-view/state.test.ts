import { describe, expect, it } from "vitest";

import type { Thread } from "../../../src/domain/threads/model";
import {
  completedThreadAutoNameState,
  editingThreadRenameState,
  generatedThreadAutoNameState,
  startedThreadAutoNameState,
  threadRows,
  updatedThreadRenameState,
} from "../../../src/features/threads-view/state";

describe("threads view rename state", () => {
  it("keeps a late auto-name result from reviving a cancelled rename", () => {
    const generating = startedThreadAutoNameState(editingThreadRenameState("Original draft"));
    expect(generating).not.toBeNull();
    if (!generating) throw new Error("Expected generating state");

    expect(generatedThreadAutoNameState(undefined, generating, "Late title")).toBeNull();
    expect(completedThreadAutoNameState(undefined, generating)).toBeUndefined();
  });

  it("keeps a manually edited draft when auto-name finishes later", () => {
    const generating = startedThreadAutoNameState(editingThreadRenameState("Original draft"));
    expect(generating).not.toBeNull();
    if (!generating) throw new Error("Expected generating state");

    const manuallyEdited = updatedThreadRenameState(generating, "Manual draft");

    expect(generatedThreadAutoNameState(manuallyEdited, generating, "Late title")).toBeNull();
    expect(completedThreadAutoNameState(manuallyEdited, generating)).toEqual({ kind: "editing", draft: "Manual draft" });
  });

  it("applies generated titles only to the active unchanged generation", () => {
    const generating = startedThreadAutoNameState(editingThreadRenameState("Original draft"));
    expect(generating).not.toBeNull();
    if (!generating) throw new Error("Expected generating state");

    const generated = generatedThreadAutoNameState(generating, generating, "Generated title");

    expect(generated).toEqual({ kind: "generating", draft: "Generated title", originalDraft: "Original draft" });
    expect(completedThreadAutoNameState(generated ?? undefined, generating)).toEqual({ kind: "editing", draft: "Generated title" });
  });

  it("initializes rename drafts from normalized explicit thread names", () => {
    expect(threadRows([thread({ name: "  Saved   name  ", preview: "Preview" })], [], new Map())[0]?.rename.draft).toBe("Saved name");
    expect(threadRows([thread({ name: "  ", preview: "Preview title" })], [], new Map())[0]?.rename.draft).toBe("Preview title");
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
