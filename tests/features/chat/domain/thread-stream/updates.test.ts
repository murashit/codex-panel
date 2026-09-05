import { describe, expect, it } from "vitest";
import type { ThreadStreamItem } from "../../../../../src/features/chat/domain/thread-stream/items";
import {
  attachHookRunsToTurn,
  completeReasoningItems,
  upsertThreadStreamItemById,
} from "../../../../../src/features/chat/domain/thread-stream/updates";

describe("thread stream item updates", () => {
  it("appends new items and replaces matching items in place", () => {
    const first = reasoningItem("r1", "turn");
    const previous = commandItem("c1", "running");
    const completed = { ...previous, status: "completed", executionState: "completed" } satisfies ThreadStreamItem;

    expect(upsertThreadStreamItemById([first], previous)).toEqual([first, previous]);

    const replaced = upsertThreadStreamItemById([first, previous], completed);
    expect(replaced.map((item) => item.id)).toEqual(["r1", "c1"]);
    expect(replaced[0]).toBe(first);
    expect(replaced[1]).toMatchObject({ status: "completed", executionState: "completed" });
  });

  it("does not overwrite streamed output with an empty completed item", () => {
    const streamed = { ...commandItem("c1", "running"), output: "partial output" } satisfies ThreadStreamItem;
    const completed = { ...commandItem("c1", "completed"), output: "" } satisfies ThreadStreamItem;

    expect(upsertThreadStreamItemById([streamed], completed)[0]).toMatchObject({
      output: "partial output",
      status: "completed",
    });
  });

  it("uses non-empty replacement output and preserves streamed file changes when completion omits them", () => {
    const streamedCommand = { ...commandItem("c1", "running"), output: "partial" } satisfies ThreadStreamItem;
    const completedCommand = { ...commandItem("c1", "completed"), output: "complete" } satisfies ThreadStreamItem;
    const streamedChange = fileChangeItem("f1", "running", [{ kind: "update", path: "src/a.ts", diff: "@@ streamed" }]);
    const completedChange = fileChangeItem("f1", "completed", []);

    expect(upsertThreadStreamItemById([streamedCommand], completedCommand)[0]).toMatchObject({ output: "complete" });
    expect(upsertThreadStreamItemById([streamedChange], completedChange)[0]).toMatchObject({
      status: "completed",
      changes: streamedChange.changes,
    });

    const finalChanges = [{ kind: "update", path: "src/a.ts", diff: "@@ complete" }];
    expect(upsertThreadStreamItemById([streamedChange], fileChangeItem("f1", "completed", finalChanges))[0]).toMatchObject({
      changes: finalChanges,
    });
  });

  it("completes reasoning only for the selected turn while preserving unrelated item references", () => {
    const selected = reasoningItem("selected", "turn");
    const otherTurn = reasoningItem("other", "other-turn");
    const command = { ...commandItem("command", "running"), turnId: "turn" } satisfies ThreadStreamItem;

    const result = completeReasoningItems([selected, otherTurn, command], "turn");

    expect(result[0]).toEqual({ ...selected, status: "completed", executionState: "completed" });
    expect(result[1]).toBe(otherTurn);
    expect(result[2]).toBe(command);
  });

  it("attaches selected hooks to a turn immediately after an explicit anchor", () => {
    const first = userMessage("user", "turn");
    const anchor = commandItem("anchor", "completed");
    const firstHook = hookItem("hook-1");
    const last = commandItem("last", "completed");
    const secondHook = hookItem("hook-2");

    const result = attachHookRunsToTurn([first, firstHook, anchor, last, secondHook], "turn", ["hook-1", "hook-2"], "anchor");

    expect(result.map((item) => item.id)).toEqual(["user", "anchor", "hook-1", "hook-2", "last"]);
    expect(result.filter((item) => item.kind === "hook").map((item) => item.turnId)).toEqual(["turn", "turn"]);
  });

  it("falls back to the target turn initiator rather than a steer or another turn", () => {
    const targetPrompt = userMessage("target-prompt", "turn");
    const targetSteer = {
      ...userMessage("target-steer", "turn"),
      provenance: { source: "localUser", channel: "optimistic", interaction: "steer", sourceId: "target-steer" },
    } satisfies ThreadStreamItem;
    const otherPrompt = userMessage("other-prompt", "other-turn");
    const hook = hookItem("hook");

    const result = attachHookRunsToTurn([targetPrompt, targetSteer, otherPrompt, hook], "turn", ["hook"]);

    expect(result.map((item) => item.id)).toEqual(["target-prompt", "hook", "target-steer", "other-prompt"]);
    expect(result[1]).toMatchObject({ id: "hook", turnId: "turn" });
  });

  it("uses the latest eligible user message as the fallback anchor", () => {
    const earlier = userMessage("earlier");
    const later = userMessage("later");
    const hook = hookItem("hook");

    expect(attachHookRunsToTurn([earlier, later, hook], "turn", ["hook"]).map((item) => item.id)).toEqual(["earlier", "later", "hook"]);
  });

  it("appends attached hooks when no user-message anchor exists", () => {
    const command = commandItem("command", "completed");
    const hook = hookItem("hook");

    const result = attachHookRunsToTurn([hook, command], "turn", ["hook"]);

    expect(result.map((item) => item.id)).toEqual(["command", "hook"]);
    expect(result[1]).toMatchObject({ id: "hook", turnId: "turn" });
  });

  it("appends attached hooks when an explicit anchor is missing and leaves items unchanged when hooks are missing", () => {
    const prompt = userMessage("prompt", "turn");
    const hook = hookItem("hook");

    expect(attachHookRunsToTurn([hook, prompt], "turn", ["hook"], "missing").map((item) => item.id)).toEqual(["prompt", "hook"]);

    const items = [prompt, hook];
    const withoutMatchingHooks = attachHookRunsToTurn(items, "turn", ["missing"]);
    expect(withoutMatchingHooks).toEqual(items);
  });
});

function userMessage(id: string, turnId?: string): ThreadStreamItem {
  return { id, kind: "dialogue", dialogueKind: "user", role: "user", text: id, ...(turnId ? { turnId } : {}) };
}

function commandItem(id: string, status: string): Extract<ThreadStreamItem, { kind: "command" }> {
  return {
    id,
    sourceItemId: id,
    kind: "command",
    role: "tool",
    commandAction: "command",
    commandTarget: { kind: "command", commandLine: "npm test" },
    command: "npm test",
    cwd: "/vault",
    status,
  };
}

function fileChangeItem(
  id: string,
  status: string,
  changes: Extract<ThreadStreamItem, { kind: "fileChange" }>["changes"],
): Extract<ThreadStreamItem, { kind: "fileChange" }> {
  return { id, kind: "fileChange", role: "tool", status, changes };
}

function reasoningItem(id: string, turnId: string): Extract<ThreadStreamItem, { kind: "reasoning" }> {
  return { id, kind: "reasoning", role: "tool", text: id, turnId, status: "running", executionState: "running" };
}

function hookItem(id: string): Extract<ThreadStreamItem, { kind: "hook" }> {
  return { id, kind: "hook", role: "tool", text: id };
}
