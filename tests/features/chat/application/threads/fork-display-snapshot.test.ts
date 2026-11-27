import { describe, expect, it } from "vitest";
import { initialChatThreadStreamState, threadStreamActiveState } from "../../../../../src/features/chat/application/state/thread-stream";
import { captureForkDisplaySnapshot } from "../../../../../src/features/chat/application/threads/fork-display-snapshot";
import { taskProgressFixture as taskProgress } from "../../support/thread-stream";

describe("fork display snapshots", () => {
  it.each([
    { kind: "through-turn", turnId: "turn-1", items: ["u1", "plan-progress-turn-1"], diffs: [["turn-1", "diff one"]], cursor: "older" },
    { kind: "before-turn", turnId: "turn-2", items: ["u1", "plan-progress-turn-1"], diffs: [["turn-1", "diff one"]], cursor: "older" },
    { kind: "before-turn", turnId: "turn-1", items: [], diffs: [], cursor: "older" },
    { kind: "before-turn", turnId: "unloaded", items: [], diffs: [], cursor: null },
  ] as const)("captures scoped items, diffs and paging cursor $kind $turnId", ({ kind, turnId, items, diffs, cursor }) => {
    const stable = initialChatThreadStreamState([
      taskProgress("turn-1", { id: "u1" }),
      { id: "system", kind: "system", role: "system", text: "Do not inherit" },
      taskProgress("turn-1"),
      taskProgress("turn-2", { id: "u2" }),
    ]);
    const state = {
      ...stable,
      historyCursor: "older",
      ...threadStreamActiveState("turn-active", [taskProgress("turn-active")]),
      turnDiffs: new Map([
        ["turn-1", "diff one"],
        ["turn-2", "diff two"],
      ]),
    };

    const snapshot = captureForkDisplaySnapshot(state, { kind, turnId });

    expect(snapshot.items.map((item) => item.id)).toEqual(items);
    expect([...snapshot.turnDiffs]).toEqual(diffs);
    expect(snapshot.historyCursor).toBe(cursor);
  });
});
