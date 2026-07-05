import { describe, expect, it } from "vitest";

import {
  acknowledgeOptimisticTurnStart,
  cleanupFailedTurnStart,
  localUserMessageItemFromInput,
  optimisticTurnStart,
  shouldAcknowledgeTurnStart,
} from "../../../../../src/features/chat/application/conversation/optimistic-turn-start";
import type { MessageStreamItem } from "../../../../../src/features/chat/domain/message-stream/items";

describe("optimistic turn start helpers", () => {
  it("builds optimistic turn starts from immutable input snapshots", () => {
    const input = [
      { type: "text" as const, text: "hello [[Note]]" },
      { type: "mention" as const, name: "Note", path: "Note.md" },
    ];

    const start = optimisticTurnStart({ id: "local-user", text: "hello [[Note]]", codexInput: input });

    expect(start.pendingTurnStart).toEqual({ anchorItemId: "local-user", promptSubmitHookItemIds: [] });
    expect(start.item).toMatchObject({
      id: "local-user",
      kind: "message",
      messageKind: "user",
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

  it("keeps additional context out of optimistic user message text", () => {
    const text = "Read [[Note]].";
    const input = [
      { type: "text" as const, text },
      { type: "mention" as const, name: "Note", path: "Note.md" },
      {
        type: "additionalContext" as const,
        key: "codex_panel_obsidian_context",
        kind: "untrusted" as const,
        value: "Obsidian context for the current user input:\nResolved wikilinks:\n- [[Note]] -> Note.md",
      },
    ];

    expect(localUserMessageItemFromInput({ id: "local-user", text, codexInput: input })).toMatchObject({
      text,
      copyText: text,
      mentionedFiles: [{ name: "Note", path: "Note.md" }],
    });
  });

  it("keeps active file mentions visible even when the same file is mentioned explicitly", () => {
    const text = "Read [[Note]].";
    const input = [
      { type: "text" as const, text },
      { type: "mention" as const, name: "Note", path: "Note.md" },
      { type: "mention" as const, name: "Note duplicate", path: "Note.md" },
      { type: "mention" as const, name: "<active>", path: "Note.md" },
    ];

    expect(localUserMessageItemFromInput({ id: "local-user", text, codexInput: input })).toMatchObject({
      mentionedFiles: [
        { name: "Note", path: "Note.md" },
        { name: "Active file", path: "Note.md" },
      ],
    });
  });

  it("formats resolved skill references in optimistic user messages only for display", () => {
    const text = "Use $obsidian-codex-panel-maintain and $missing.";
    const input = [
      { type: "text" as const, text },
      {
        type: "skill" as const,
        name: "obsidian-codex-panel-maintain",
        path: "/skills/obsidian-codex-panel-maintain/SKILL.md",
      },
    ];

    expect(localUserMessageItemFromInput({ id: "steer", text, codexInput: input })).toMatchObject({
      text: "Use `$obsidian-codex-panel-maintain` and $missing.",
      copyText: "Use $obsidian-codex-panel-maintain and $missing.",
    });
  });

  it("keeps turn start acknowledgement matching explicit", () => {
    expect(
      shouldAcknowledgeTurnStart({
        expectedThreadId: "thread",
        activeThreadId: "thread",
        pendingTurnStart: { anchorItemId: "local-user", promptSubmitHookItemIds: [] },
        activeTurnId: null,
        optimisticUserId: "local-user",
        responseTurnId: "turn",
      }),
    ).toBe(true);
    expect(
      shouldAcknowledgeTurnStart({
        expectedThreadId: "thread",
        activeThreadId: "thread",
        pendingTurnStart: null,
        activeTurnId: "turn",
        optimisticUserId: "local-user",
        responseTurnId: "turn",
      }),
    ).toBe(true);
    expect(
      shouldAcknowledgeTurnStart({
        expectedThreadId: "thread",
        activeThreadId: "thread",
        pendingTurnStart: { anchorItemId: "other", promptSubmitHookItemIds: [] },
        activeTurnId: "stale-turn",
        optimisticUserId: "local-user",
        responseTurnId: "turn",
      }),
    ).toBe(false);
    expect(
      shouldAcknowledgeTurnStart({
        expectedThreadId: "thread",
        activeThreadId: "other-thread",
        pendingTurnStart: { anchorItemId: "local-user", promptSubmitHookItemIds: [] },
        activeTurnId: null,
        optimisticUserId: "local-user",
        responseTurnId: "turn",
      }),
    ).toBe(false);
  });

  it("attaches acknowledged turn ids and pending hook runs immutably", () => {
    const items: MessageStreamItem[] = [
      localUserMessage("local-user", "hello"),
      hookItem("hook-1"),
      { id: "assistant", kind: "message", role: "assistant", text: "working", messageKind: "assistantResponse", messageState: "completed" },
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
    const items: MessageStreamItem[] = [localUserMessage("local-user", "hello"), hookItem("hook-1"), hookItem("keep")];

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

function localUserMessage(id: string, text: string): MessageStreamItem {
  return localUserMessageItemFromInput({ id, text, codexInput: [{ type: "text", text }] });
}

function hookItem(id: string): MessageStreamItem {
  return {
    id,
    kind: "hook",
    role: "tool",
    text: "hook",
  };
}
