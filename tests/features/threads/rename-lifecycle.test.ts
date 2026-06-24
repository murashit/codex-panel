import { describe, expect, it } from "vitest";

import {
  initialThreadRenameLifecycleState,
  type ThreadRenameGeneratingState,
  type ThreadRenameLifecycleState,
  transitionThreadRenameLifecycleState,
} from "../../../src/features/threads/rename-lifecycle";

describe("thread rename lifecycle", () => {
  it("keeps late generation callbacks scoped to the active unchanged generation", () => {
    const generating = generatingRenameState("Original draft", 1);

    const staleGenerated = transitionThreadRenameLifecycleState(generating, {
      type: "generation-succeeded",
      generatingState: { ...generating, generationToken: 2 },
      draft: "Late title",
    });
    expect(staleGenerated).toBe(generating);

    const manuallyEdited = transitionThreadRenameLifecycleState(generating, { type: "draft-updated", draft: "Manual draft" });
    const generatedAfterManualEdit = transitionThreadRenameLifecycleState(manuallyEdited, {
      type: "generation-succeeded",
      generatingState: generating,
      draft: "Generated title",
    });
    expect(generatedAfterManualEdit).toBe(manuallyEdited);

    expect(transitionThreadRenameLifecycleState(manuallyEdited, { type: "generation-finished", generatingState: generating })).toEqual({
      kind: "editing",
      draft: "Manual draft",
    });
  });

  it("ignores stale generation state with a mismatched original draft", () => {
    const generating = generatingRenameState("Original draft", 1);
    const staleGenerating = { ...generating, originalDraft: "Other draft" };

    expect(
      transitionThreadRenameLifecycleState(generating, {
        type: "generation-succeeded",
        generatingState: staleGenerating,
        draft: "Late title",
      }),
    ).toBe(generating);
    expect(transitionThreadRenameLifecycleState(generating, { type: "generation-finished", generatingState: staleGenerating })).toBe(
      generating,
    );
  });

  it("does not create an editor from a stray draft update", () => {
    const idle = initialThreadRenameLifecycleState();

    expect(transitionThreadRenameLifecycleState(idle, { type: "draft-updated", draft: "Stray" })).toBe(idle);
  });
});

function generatingRenameState(draft: string, generationToken: number): ThreadRenameGeneratingState {
  const editing = expectRenameState(transitionThreadRenameLifecycleState(initialThreadRenameLifecycleState(), { type: "started", draft }));
  const generating = transitionThreadRenameLifecycleState(editing, { type: "generation-started", generationToken });
  if (generating.kind !== "generating") throw new Error("Expected generating rename state.");
  return generating;
}

function expectRenameState(state: ThreadRenameLifecycleState): ThreadRenameLifecycleState {
  if (state.kind === "idle") throw new Error("Expected rename state.");
  return state;
}
