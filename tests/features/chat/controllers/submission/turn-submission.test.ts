import { describe, expect, it } from "vitest";

import {
  acknowledgeOptimisticTurnStart,
  cleanupFailedTurnStart,
  localUserMessageItem,
  localUserMessageItemFromInput,
  optimisticTurnStart,
  shouldAcknowledgeTurnStart,
} from "../../../../../src/features/chat/controllers/submission/turn-submission";
import type { DisplayItem } from "../../../../../src/features/chat/display/types";

describe("chat turn submission helpers", () => {
  it("builds local user messages without sharing mentioned file arrays", () => {
    const mentionedFiles = [{ name: "Note", path: "Note.md" }];
    const item = localUserMessageItem({ id: "local", text: "hello", mentionedFiles });

    mentionedFiles.push({ name: "Other", path: "Other.md" });

    expect(item).toMatchObject({ id: "local", kind: "message", role: "user", text: "hello", copyText: "hello", markdown: true });
    expect(item.mentionedFiles).toEqual([{ name: "Note", path: "Note.md" }]);
  });

  it("builds optimistic turn starts from immutable input snapshots", () => {
    const input = [
      { type: "text" as const, text: "hello [[Note]]", text_elements: [] },
      { type: "mention" as const, name: "Note", path: "Note.md" },
    ];

    const start = optimisticTurnStart({ id: "local-user", text: "hello [[Note]]", codexInput: input });

    expect(start.pendingTurnStart).toEqual({ anchorItemId: "local-user", promptSubmitHookItemIds: [] });
    expect(start.item).toMatchObject({
      id: "local-user",
      kind: "message",
      role: "user",
      text: "hello [[Note]]",
      mentionedFiles: [{ name: "Note", path: "Note.md" }],
    });

    expect(localUserMessageItemFromInput({ id: "steer", text: "hello [[Note]]", turnId: "turn", codexInput: input })).toMatchObject({
      id: "steer",
      turnId: "turn",
      mentionedFiles: [{ name: "Note", path: "Note.md" }],
    });
  });

  it("keeps turn start acknowledgement matching explicit", () => {
    expect(
      shouldAcknowledgeTurnStart({
        pendingTurnStart: { anchorItemId: "local-user", promptSubmitHookItemIds: [] },
        activeTurnId: null,
        optimisticUserId: "local-user",
        responseTurnId: "turn",
      }),
    ).toBe(true);
    expect(
      shouldAcknowledgeTurnStart({
        pendingTurnStart: null,
        activeTurnId: "turn",
        optimisticUserId: "local-user",
        responseTurnId: "turn",
      }),
    ).toBe(true);
    expect(
      shouldAcknowledgeTurnStart({
        pendingTurnStart: { anchorItemId: "other", promptSubmitHookItemIds: [] },
        activeTurnId: "stale-turn",
        optimisticUserId: "local-user",
        responseTurnId: "turn",
      }),
    ).toBe(false);
  });

  it("attaches acknowledged turn ids and pending hook runs immutably", () => {
    const items: DisplayItem[] = [
      localUserMessageItem({ id: "local-user", text: "hello" }),
      hookItem("hook-1"),
      { id: "assistant", kind: "message", role: "assistant", text: "working" },
    ];

    const next = acknowledgeOptimisticTurnStart({
      items,
      optimisticUserId: "local-user",
      turnId: "turn",
      pendingTurnStart: { anchorItemId: "local-user", promptSubmitHookItemIds: ["hook-1"] },
    });

    expect(next.map((item) => item.id)).toEqual(["local-user", "hook-1", "assistant"]);
    expect(next.find((item) => item.id === "local-user")?.turnId).toBe("turn");
    expect(next.find((item) => item.id === "hook-1")?.turnId).toBe("turn");
    expect(items.find((item) => item.id === "local-user")?.turnId).toBeUndefined();
    expect(items.find((item) => item.id === "hook-1")?.turnId).toBeUndefined();
  });

  it("removes optimistic user and pending hook items after start failure", () => {
    const items: DisplayItem[] = [localUserMessageItem({ id: "local-user", text: "hello" }), hookItem("hook-1"), hookItem("keep")];

    expect(
      cleanupFailedTurnStart({
        items,
        optimisticUserId: "local-user",
        pendingTurnStart: { anchorItemId: "local-user", promptSubmitHookItemIds: ["hook-1"] },
      }).map((item) => item.id),
    ).toEqual(["keep"]);
    expect(items.map((item) => item.id)).toEqual(["local-user", "hook-1", "keep"]);
  });
});

function hookItem(id: string): DisplayItem {
  return {
    id,
    kind: "hook",
    role: "tool",
    text: "hook",
  };
}
