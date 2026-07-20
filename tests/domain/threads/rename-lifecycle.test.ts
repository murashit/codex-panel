import { describe, expect, it } from "vitest";

import {
  initialThreadRenameLifecycleState,
  type ThreadRenameLifecycleState,
  transitionThreadRenameLifecycleState,
} from "../../../src/domain/threads/rename-lifecycle";

describe("thread rename lifecycle", () => {
  it("keeps late generation callbacks scoped to the active unchanged generation", () => {
    const generating = generatingRenameState("Original draft", 1);

    const staleGenerated = transitionThreadRenameLifecycleState(generating, {
      type: "generation-succeeded",
      generationToken: 2,
      draft: "Late title",
    });
    expect(staleGenerated).toBe(generating);

    const manuallyEdited = transitionThreadRenameLifecycleState(generating, { type: "draft-updated", draft: "Manual draft" });
    const generatedAfterManualEdit = transitionThreadRenameLifecycleState(manuallyEdited, {
      type: "generation-succeeded",
      generationToken: generating.generationToken,
      draft: "Generated title",
    });
    expect(generatedAfterManualEdit).toBe(manuallyEdited);

    expect(
      transitionThreadRenameLifecycleState(manuallyEdited, {
        type: "generation-finished",
        generationToken: generating.generationToken,
      }),
    ).toEqual({ kind: "editing", draft: "Manual draft" });
  });

  it("does not create an editor from a stray draft update", () => {
    const idle = initialThreadRenameLifecycleState();

    expect(transitionThreadRenameLifecycleState(idle, { type: "draft-updated", draft: "Stray" })).toBe(idle);
  });
});

type ThreadRenameGeneratingState = Extract<ThreadRenameLifecycleState, { kind: "generating" }>;

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
