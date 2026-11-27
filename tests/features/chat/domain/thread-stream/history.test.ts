import { describe, expect, it } from "vitest";
import { threadStreamItemFromTurnItem } from "../../../../../src/features/chat/app-server/mappers/thread-stream/turn-items";
import { reconcileHistoryItems } from "../../../../../src/features/chat/domain/thread-stream/history";
import type { ThreadStreamItem } from "../../../../../src/features/chat/domain/thread-stream/items";
import { completeReasoningItems } from "../../../../../src/features/chat/domain/thread-stream/updates";
import { threadStreamLayoutBlocks } from "../../../../../src/features/chat/ui/thread-stream/layout";
import { taskProgressFixture as taskProgress } from "../../support/thread-stream";

describe("thread history reconciliation", () => {
  it("keeps display-only items while preferring hydrated app-server items", () => {
    const displayItems = [message("u1", "turn-1", "local"), taskProgress("turn-1"), message("u2", "turn-2", "local")];
    const historyItems = [message("u1", "turn-1", "server"), message("a1", "turn-1", "answer"), message("u2", "turn-2", "server")];

    const reconciled = reconcileHistoryItems(displayItems, [
      { id: "turn-1", items: historyItems.slice(0, 2) },
      { id: "turn-2", items: historyItems.slice(2) },
    ]);

    expect(reconciled.map((item) => item.id)).toEqual(["u1", "plan-progress-turn-1", "a1", "u2"]);
    expect(reconciled.find((item) => item.id === "u1")).toMatchObject({ text: "server" });
  });

  it("replaces a matching live error notice with the saved terminal error during history hydration", () => {
    const liveNotice = systemErrorNotice("notice", "Final detail.");
    const terminal = terminalError("Final detail.");

    const reconciled = reconcileHistoryItems(
      [message("u1", "turn-1"), liveNotice],
      [{ id: "turn-1", items: [message("u1", "turn-1"), terminal] }],
    );

    expect(reconciled.map((item) => item.id)).toEqual(["u1", terminal.id]);
  });

  it("keeps completed empty reasoning hidden across repeated history hydration", () => {
    const historyItem = threadStreamItemFromTurnItem({ type: "reasoning", id: "reasoning", summary: [], content: [] }, "turn");
    if (!historyItem) throw new Error("Expected a mapped reasoning item.");
    let items = completeReasoningItems([historyItem], "turn");

    for (let pass = 0; pass < 2; pass++) {
      items = reconcileHistoryItems(items, [{ id: "turn", items: [historyItem] }]);

      expect(items).toMatchObject([{ kind: "reasoning", statusLabel: "Completed", executionState: "completed" }]);
      expect(threadStreamLayoutBlocks(items, null, "/vault", new Map())).toEqual([]);
    }
  });

  it("keeps the complete display payload for an already-hydrated user item", () => {
    const displayUser = {
      id: "server-user",
      kind: "dialogue",
      dialogueKind: "user",
      role: "user",
      text: "Displayed prompt",
      copyText: "Copyable prompt",
      turnId: "turn",
      contextAttachments: [{ label: "Obsidian context", detail: "Note" }],
      referencedFiles: [{ name: "Note", path: "Note.md" }],
    } satisfies ThreadStreamItem;
    const historyUser = {
      id: "server-user",
      kind: "dialogue",
      dialogueKind: "user",
      role: "user",
      text: "Canonical prompt",
      turnId: "turn",
    } satisfies ThreadStreamItem;

    expect(reconcileHistoryItems([displayUser], [{ id: "turn", items: [historyUser] }])).toEqual([
      {
        ...displayUser,
        text: "Canonical prompt",
      },
    ]);
  });
});

function message(id: string, turnId: string, text = id): ThreadStreamItem {
  return {
    id,
    kind: "dialogue",
    dialogueKind: "assistantResponse",
    role: "assistant",
    text,
    dialogueState: "completed",
    turnId,
  };
}

function systemErrorNotice(id: string, detail: string): ThreadStreamItem {
  return {
    id,
    kind: "system",
    role: "system",
    text: "The request failed.",
    turnId: "turn-1",
    noticeSections: [{ body: detail }, { body: "Codex will not retry automatically." }],
    provenance: { source: "panel", channel: "notice", reason: "runtimeError", sourceId: id },
  };
}

function terminalError(detail: string): ThreadStreamItem {
  return {
    id: "turn-error:turn-1",
    kind: "system",
    role: "system",
    text: "The request failed.",
    turnId: "turn-1",
    noticeSections: [{ body: detail }],
    provenance: { source: "panel", channel: "notice", reason: "turnError", sourceId: "turn-1" },
  };
}
