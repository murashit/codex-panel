import { describe, expect, it } from "vitest";

import {
  initialThreadRenameLifecycleState,
  type ThreadRenameLifecycleState,
  transitionThreadRenameLifecycleState,
} from "../../../src/domain/threads/rename-lifecycle";

describe("thread rename lifecycle", () => {
  it("blocks draft updates and keeps callbacks scoped to the active generation", () => {
    const generating = generatingRenameState("Original draft", 1);

    const staleGenerated = transitionThreadRenameLifecycleState(generating, {
      type: "generation-succeeded",
      generationToken: 2,
      draft: "Late title",
    });
    expect(staleGenerated).toBe(generating);

    const draftUpdate = transitionThreadRenameLifecycleState(generating, { type: "draft-updated", draft: "Manual draft" });
    expect(draftUpdate).toBe(generating);

    const generated = transitionThreadRenameLifecycleState(draftUpdate, {
      type: "generation-succeeded",
      generationToken: generating.generationToken,
      draft: "Generated title",
    });
    expect(generated).toEqual({ ...generating, draft: "Generated title" });

    expect(
      transitionThreadRenameLifecycleState(generated, {
        type: "generation-finished",
        generationToken: generating.generationToken,
      }),
    ).toEqual({ kind: "editing", draft: "Generated title", autoName: generating.autoName });
  });

  it("does not create an editor from a stray draft update", () => {
    const idle = initialThreadRenameLifecycleState();

    expect(transitionThreadRenameLifecycleState(idle, { type: "draft-updated", draft: "Stray" })).toBe(idle);
  });
});

type ThreadRenameGeneratingState = Extract<ThreadRenameLifecycleState, { kind: "generating" }>;

function generatingRenameState(draft: string, generationToken: number): ThreadRenameGeneratingState {
  const editing = expectRenameState(transitionThreadRenameLifecycleState(initialThreadRenameLifecycleState(), { type: "started", draft }));
  const ready = transitionThreadRenameLifecycleState(editing, {
    type: "auto-name-context-resolved",
    context: { userRequest: "Request", assistantResponse: "Response" },
  });
  const generating = transitionThreadRenameLifecycleState(ready, { type: "generation-started", generationToken });
  if (generating.kind !== "generating") throw new Error("Expected generating rename state.");
  return generating;
}

function expectRenameState(state: ThreadRenameLifecycleState): ThreadRenameLifecycleState {
  if (state.kind === "idle") throw new Error("Expected rename state.");
  return state;
}
