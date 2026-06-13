import { describe, expect, it } from "vitest";

import { timelineItemsFromMessageStreamItems } from "../../../../../src/features/chat/message-stream/timeline/from-items";
import type { MessageStreamItem } from "../../../../../src/features/chat/message-stream/items";

describe("timeline item semantics", () => {
  it("classifies transcript messages separately from steering", () => {
    const timeline = timelineItemsFromMessageStreamItems([
      userMessage("u1", "do it", "turn"),
      userMessage("u2", "also check tests", "turn"),
      {
        id: "a1",
        kind: "message",
        messageKind: "assistantResponse",
        messageState: "completed",
        role: "assistant",
        text: "done",
        turnId: "turn",
      },
    ]);

    expect(timeline.map(({ semanticKind, authorship, placement }) => ({ semanticKind, authorship, placement }))).toEqual([
      { semanticKind: "userPrompt", authorship: "user", placement: "primaryTranscript" },
      { semanticKind: "steering", authorship: "user", placement: "workLog" },
      { semanticKind: "assistantResponse", authorship: "assistant", placement: "primaryTranscript" },
    ]);
    expect(timeline[2]?.actions).toMatchObject({ isTurnOutcome: true, canForkFromHere: true });
  });

  it("keeps work logs out of the primary transcript", () => {
    const timeline = timelineItemsFromMessageStreamItems([
      commandItem("cmd"),
      {
        id: "patch",
        kind: "fileChange",
        role: "tool",
        text: "File change completed",
        status: "completed",
        changes: [{ kind: "update", path: "src/main.ts", diff: "@@" }],
        executionState: "completed",
      },
      { id: "tool", kind: "tool", role: "tool", text: "tool", details: [{ rows: [{ key: "k", value: "v" }] }] },
      { id: "hook", kind: "hook", role: "tool", text: "hook" },
      { id: "reasoning", kind: "reasoning", role: "tool", text: "thinking" },
    ]);

    expect(
      timeline.map(({ semanticKind, placement, detailShape, renderSurface }) => ({ semanticKind, placement, detailShape, renderSurface })),
    ).toEqual([
      { semanticKind: "commandRun", placement: "workLog", detailShape: "commandAudit", renderSurface: "toolResult" },
      { semanticKind: "filePatch", placement: "workLog", detailShape: "diffSet", renderSurface: "toolResult" },
      { semanticKind: "toolCall", placement: "workLog", detailShape: "jsonAudit", renderSurface: "toolResult" },
      { semanticKind: "hookRun", placement: "workLog", detailShape: "plainText", renderSurface: "toolResult" },
      { semanticKind: "reasoningNote", placement: "workLog", detailShape: "plainText", renderSurface: "workItem" },
    ]);
  });

  it("classifies thread and interaction events by meaning before renderer shape", () => {
    const timeline = timelineItemsFromMessageStreamItems([
      { id: "goal", kind: "goal", role: "tool", text: "set: Ship it" },
      { id: "approval", kind: "approvalResult", role: "tool", text: "Approved" },
      { id: "input", kind: "userInputResult", role: "tool", text: "Answered" },
      { id: "review", kind: "reviewResult", role: "tool", text: "Auto-review approved" },
      { id: "compact", kind: "contextCompaction", role: "tool", text: "Context compaction" },
      { id: "system", kind: "system", role: "system", text: "Disconnected" },
    ]);

    expect(
      timeline.map(({ semanticKind, authorship, placement, renderSurface }) => ({ semanticKind, authorship, placement, renderSurface })),
    ).toEqual([
      { semanticKind: "goalChange", authorship: "runtime", placement: "workLog", renderSurface: "toolResult" },
      { semanticKind: "approvalResult", authorship: "runtime", placement: "workLog", renderSurface: "toolResult" },
      { semanticKind: "userInputResult", authorship: "user", placement: "workLog", renderSurface: "textMessage" },
      { semanticKind: "reviewResult", authorship: "runtime", placement: "workLog", renderSurface: "toolResult" },
      { semanticKind: "contextCompaction", authorship: "runtime", placement: "workLog", renderSurface: "workItem" },
      { semanticKind: "systemNotice", authorship: "panel", placement: "panelNotice", renderSurface: "textMessage" },
    ]);
  });

  it("marks completed proposed plans as implementable turn outcomes", () => {
    const [draft, completed] = timelineItemsFromMessageStreamItems([
      { id: "draft", kind: "message", messageKind: "proposedPlan", messageState: "streaming", role: "assistant", text: "draft" },
      { id: "plan", kind: "message", messageKind: "proposedPlan", messageState: "completed", role: "assistant", text: "plan" },
    ]);

    expect(draft).toMatchObject({
      semanticKind: "proposedPlan",
      detailShape: "plainText",
      actions: { canImplementPlan: false, isTurnOutcome: false },
    });
    expect(completed).toMatchObject({
      semanticKind: "proposedPlan",
      detailShape: "markdownText",
      actions: { canImplementPlan: true, isTurnOutcome: true },
    });
  });
});

function userMessage(id: string, text: string, turnId: string): MessageStreamItem {
  return { id, kind: "message", messageKind: "user", role: "user", text, turnId };
}

function commandItem(id: string): MessageStreamItem {
  return {
    id,
    kind: "command",
    role: "tool",
    text: "npm test",
    command: "npm test",
    cwd: "/vault",
    status: "completed",
    executionState: "completed",
  };
}
