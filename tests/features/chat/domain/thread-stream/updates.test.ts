import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { ThreadStreamItem } from "../../../../../src/features/chat/domain/thread-stream/items";
import { completeReasoningItems, upsertThreadStreamItemById } from "../../../../../src/features/chat/domain/thread-stream/updates";

describe("thread stream item updates", () => {
  it("keeps item order and unrelated identities across arbitrary upserts", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: 20 }), { maxLength: 12 }),
        fc.integer({ min: 0, max: 20 }),
        fc.string({ maxLength: 20 }),
        fc.string({ maxLength: 20 }),
        (ids, targetId, previousOutput, nextOutput) => {
          const items = ids.map((id) => ({ ...commandItem(String(id), "Running"), output: id === targetId ? previousOutput : "" }));
          const next = { ...commandItem(String(targetId), "Completed"), output: nextOutput, executionState: "completed" as const };
          const result = upsertThreadStreamItemById(items, next);
          const target = result.find((item) => item.id === String(targetId));
          expect(result.map((item) => item.id)).toEqual(ids.includes(targetId) ? ids.map(String) : [...ids.map(String), String(targetId)]);
          expect(target).toMatchObject({
            statusLabel: "Completed",
            executionState: "completed",
            output: ids.includes(targetId) ? nextOutput || previousOutput : nextOutput,
          });
          for (const original of items) {
            if (original.id !== String(targetId)) expect(result.find((item) => item.id === original.id)).toBe(original);
          }
        },
      ),
    );
  });

  it("does not overwrite streamed output with an empty completed item", () => {
    const streamed = { ...commandItem("c1", "Running"), output: "partial output" } satisfies ThreadStreamItem;
    const completed = { ...commandItem("c1", "Completed"), output: "" } satisfies ThreadStreamItem;

    expect(upsertThreadStreamItemById([streamed], completed)[0]).toMatchObject({
      output: "partial output",
      statusLabel: "Completed",
    });
  });

  it("uses non-empty replacement output and preserves streamed file changes when completion omits them", () => {
    const streamedCommand = { ...commandItem("c1", "Running"), output: "partial" } satisfies ThreadStreamItem;
    const completedCommand = { ...commandItem("c1", "Completed"), output: "complete" } satisfies ThreadStreamItem;
    const streamedChange = fileChangeItem("f1", "Running", [{ kind: "update", path: "src/a.ts", diff: "@@ streamed" }]);
    const completedChange = fileChangeItem("f1", "Completed", []);

    expect(upsertThreadStreamItemById([streamedCommand], completedCommand)[0]).toMatchObject({ output: "complete" });
    expect(upsertThreadStreamItemById([streamedChange], completedChange)[0]).toMatchObject({
      statusLabel: "Completed",
      changes: streamedChange.changes,
    });

    const finalChanges = [{ kind: "update", path: "src/a.ts", diff: "@@ complete" }];
    expect(upsertThreadStreamItemById([streamedChange], fileChangeItem("f1", "Completed", finalChanges))[0]).toMatchObject({
      changes: finalChanges,
    });
  });

  it("completes reasoning only for the selected turn while preserving unrelated item references", () => {
    const selected = reasoningItem("selected", "turn");
    const otherTurn = reasoningItem("other", "other-turn");
    const command = { ...commandItem("command", "Running"), turnId: "turn" } satisfies ThreadStreamItem;

    const result = completeReasoningItems([selected, otherTurn, command], "turn");

    expect(result[0]).toEqual({ ...selected, statusLabel: "Completed", executionState: "completed" });
    expect(result[1]).toBe(otherTurn);
    expect(result[2]).toBe(command);
  });
});

function commandItem(id: string, statusLabel: string): Extract<ThreadStreamItem, { kind: "command" }> {
  return {
    id,
    sourceItemId: id,
    kind: "command",
    role: "tool",
    commandTarget: { kind: "command", commandLine: "npm test" },
    command: "npm test",
    cwd: "/vault",
    statusLabel,
  };
}

function fileChangeItem(
  id: string,
  statusLabel: string,
  changes: Extract<ThreadStreamItem, { kind: "fileChange" }>["changes"],
): Extract<ThreadStreamItem, { kind: "fileChange" }> {
  return { id, kind: "fileChange", role: "tool", statusLabel, changes };
}

function reasoningItem(id: string, turnId: string): Extract<ThreadStreamItem, { kind: "reasoning" }> {
  return { id, kind: "reasoning", role: "tool", text: id, turnId, statusLabel: "Running", executionState: "running" };
}
