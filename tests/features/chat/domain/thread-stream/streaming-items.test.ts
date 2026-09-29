import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { ThreadStreamItem } from "../../../../../src/features/chat/domain/thread-stream/items";
import {
  appendAssistantStreamingDelta,
  appendPlanStreamingDelta,
  appendTextStreamingDelta,
  appendToolOutputStreamingDelta,
} from "../../../../../src/features/chat/domain/thread-stream/streaming-items";

describe("streaming item deltas", () => {
  it("appends assistant text to an item matched by source identity", () => {
    const current = {
      id: "rendered-assistant",
      sourceItemId: "assistant",
      kind: "dialogue",
      dialogueKind: "assistantResponse",
      dialogueState: "streaming",
      role: "assistant",
      text: "hello",
      copyText: "hello",
      turnId: "turn",
    } satisfies ThreadStreamItem;

    expect(appendAssistantStreamingDelta(current, "assistant", "turn", " world")).toMatchObject({
      id: "rendered-assistant",
      text: "hello world",
      copyText: "hello world",
    });
  });

  it("creates a new streamed item when the current preview belongs to another source", () => {
    const current = toolItem("previous", "previous output");

    expect(appendPlanStreamingDelta(current, "plan", "turn", "<proposed_plan>\nWork\n</proposed_plan>")).toMatchObject({
      id: "plan",
      sourceItemId: "plan",
      kind: "dialogue",
      dialogueKind: "proposedPlan",
      text: "<proposed_plan>\nWork\n</proposed_plan>",
    });
  });

  it("preserves assistant, plan, and tool output across arbitrary chunk boundaries", () => {
    const chunk = fc.string({ unit: fc.constantFrom("<", ">", "/", "\n", "a", " ", "あ", "😀"), maxLength: 20 });
    fc.assert(
      fc.property(fc.array(chunk, { minLength: 1, maxLength: 10 }), (chunks) => {
        const expected = chunks.join("");
        const assistant = chunks.reduce<ThreadStreamItem | null>(
          (current, delta) => appendAssistantStreamingDelta(current, "assistant", "turn", delta),
          null,
        );
        const plan = chunks.reduce<ThreadStreamItem | null>(
          (current, delta) => appendPlanStreamingDelta(current, "plan", "turn", delta),
          null,
        );
        const tool = chunks.reduce<ThreadStreamItem | null>(
          (current, delta) => appendToolOutputStreamingDelta(current, "tool", "turn", delta, "tool"),
          null,
        );

        expect(assistant).toMatchObject({ text: expected, copyText: expected, turnId: "turn" });
        expect(plan).toMatchObject({ text: expected, copyText: expected, turnId: "turn" });
        expect(tool).toMatchObject({ output: expected, turnId: "turn" });
      }),
    );
  });

  it("does not reinterpret an existing source item with an incompatible kind", () => {
    const current = toolItem("shared", "output");

    expect(appendAssistantStreamingDelta(current, "shared", "turn", "text")).toBe(current);
    expect(appendTextStreamingDelta(current, "shared", "turn", "reasoning", "text", "reasoning")).toBe(current);
  });

  it("supports reasoning output only when the stream consumer opts in", () => {
    const reasoning = {
      id: "reasoning",
      sourceItemId: "reasoning",
      kind: "reasoning",
      role: "tool",
      text: "thinking",
    } satisfies ThreadStreamItem;

    expect(appendToolOutputStreamingDelta(reasoning, "reasoning", "turn", "details", "reasoning")).toBe(reasoning);
    expect(appendToolOutputStreamingDelta(reasoning, "reasoning", "turn", "details", "reasoning", { allowReasoning: true })).toMatchObject({
      output: "details",
      turnId: "turn",
    });
  });
});

function toolItem(id: string, output: string): ThreadStreamItem {
  return {
    id,
    sourceItemId: id,
    kind: "tool",
    role: "tool",
    toolName: "tool",
    output,
  };
}
