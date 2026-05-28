import { describe, expect, it } from "vitest";

import { acknowledgeOptimisticTurnStart, cleanupFailedTurnStart, localUserMessageItem } from "../../../src/features/chat/turn-submission";
import type { DisplayItem } from "../../../src/features/chat/display/types";

describe("chat turn submission helpers", () => {
  it("builds local user messages without sharing mentioned file arrays", () => {
    const mentionedFiles = [{ name: "Note", path: "Note.md" }];
    const item = localUserMessageItem({ id: "local", text: "hello", mentionedFiles });

    mentionedFiles.push({ name: "Other", path: "Other.md" });

    expect(item).toMatchObject({ id: "local", kind: "message", role: "user", text: "hello", copyText: "hello", markdown: true });
    expect(item.mentionedFiles).toEqual([{ name: "Note", path: "Note.md" }]);
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
