import { describe, expect, it } from "vitest";

import {
  initialThreadRenameLifecycleState,
  type ThreadRenameLifecycleState,
  transitionThreadRenameLifecycleState,
} from "../../../src/domain/threads/rename-lifecycle";

describe("thread rename lifecycle", () => {
  it("blocks draft updates while generation owns the draft", () => {
    const generating = generatingRenameState("Original draft");
    const draftUpdate = transitionThreadRenameLifecycleState(generating, { type: "draft-updated", draft: "Manual draft" });
    expect(draftUpdate).toBe(generating);

    const generated = transitionThreadRenameLifecycleState(draftUpdate, {
      type: "generation-succeeded",
      draft: "Generated title",
    });
    expect(generated).toEqual({ ...generating, draft: "Generated title" });

    expect(transitionThreadRenameLifecycleState(generated, { type: "generation-finished" })).toEqual({
      kind: "editing",
      draft: "Generated title",
      autoName: generating.autoName,
    });
  });

  it("does not create an editor from a stray draft update", () => {
    const idle = initialThreadRenameLifecycleState();

    expect(transitionThreadRenameLifecycleState(idle, { type: "draft-updated", draft: "Stray" })).toBe(idle);
  });

  it("serializes saving until the operation finishes", () => {
    const editing = expectRenameState(
      transitionThreadRenameLifecycleState(initialThreadRenameLifecycleState(), { type: "started", draft: "Draft" }),
    );
    const saving = transitionThreadRenameLifecycleState(editing, { type: "save-started" });
    if (saving.kind !== "saving") throw new Error("Expected saving rename state.");

    expect(transitionThreadRenameLifecycleState(saving, { type: "draft-updated", draft: "Changed" })).toBe(saving);
    expect(transitionThreadRenameLifecycleState(saving, { type: "cancelled" })).toBe(saving);
    expect(transitionThreadRenameLifecycleState(saving, { type: "started", draft: "Replacement" })).toBe(saving);
    const failed = transitionThreadRenameLifecycleState(saving, { type: "save-failed" });
    expect(failed).toEqual({ kind: "editing", draft: "Draft", autoName: { kind: "checking" } });

    const savingAgain = transitionThreadRenameLifecycleState(failed, { type: "save-started" });
    expect(transitionThreadRenameLifecycleState(savingAgain, { type: "save-succeeded" })).toEqual({ kind: "idle" });
  });
});

type ThreadRenameGeneratingState = Extract<ThreadRenameLifecycleState, { kind: "generating" }>;

function generatingRenameState(draft: string): ThreadRenameGeneratingState {
  const editing = expectRenameState(transitionThreadRenameLifecycleState(initialThreadRenameLifecycleState(), { type: "started", draft }));
  const ready = transitionThreadRenameLifecycleState(editing, {
    type: "auto-name-context-resolved",
    context: { userRequest: "Request", assistantResponse: "Response" },
  });
  const generating = transitionThreadRenameLifecycleState(ready, { type: "generation-started" });
  if (generating.kind !== "generating") throw new Error("Expected generating rename state.");
  return generating;
}

function expectRenameState(state: ThreadRenameLifecycleState): ThreadRenameLifecycleState {
  if (state.kind === "idle") throw new Error("Expected rename state.");
  return state;
}
