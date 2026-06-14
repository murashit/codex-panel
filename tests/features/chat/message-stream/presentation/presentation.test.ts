import { describe, expect, it } from "vitest";

import { presentationClassificationsFromMessageStreamItems } from "../../../../../src/features/chat/message-stream/presentation/from-items";
import type { MessageStreamItem } from "../../../../../src/features/chat/message-stream/items";

describe("message stream presentation classification", () => {
  it("classifies transcript messages separately from steering", () => {
    const presentation = presentationClassificationsFromMessageStreamItems([
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

    expect(presentation.map(({ semanticKind }) => semanticKind)).toEqual(["userPrompt", "steering", "assistantResponse"]);
    expect(presentation[2]?.actions).toMatchObject({ isTurnOutcome: true, canForkFromHere: true });
  });

  it("classifies work log item semantics", () => {
    const presentation = presentationClassificationsFromMessageStreamItems([
      commandItem("cmd"),
      {
        id: "patch",
        kind: "fileChange",
        role: "tool",
        status: "completed",
        changes: [{ kind: "update", path: "src/main.ts", diff: "@@" }],
        executionState: "completed",
      },
      { id: "tool", kind: "tool", role: "tool", text: "tool", toolCall: { arguments: { k: "v" } } },
      { id: "hook", kind: "hook", role: "tool", text: "hook" },
      { id: "reasoning", kind: "reasoning", role: "tool", text: "thinking" },
    ]);

    expect(presentation.map(({ semanticKind }) => semanticKind)).toEqual([
      "commandRun",
      "filePatch",
      "toolCall",
      "hookRun",
      "reasoningNote",
    ]);
  });

  it("classifies thread and interaction events by meaning", () => {
    const presentation = presentationClassificationsFromMessageStreamItems([
      { id: "goal", kind: "goal", role: "tool", text: "set: Ship it", action: "set" },
      {
        id: "approval",
        kind: "approvalResult",
        role: "tool",
        text: "Approved",
        approval: { status: "allowed", scope: "turn", request: "Approval", auditFacts: [] },
      },
      { id: "input", kind: "userInputResult", role: "tool", text: "Answered", questions: [] },
      { id: "review", kind: "reviewResult", role: "tool", text: "Auto-review approved" },
      { id: "compact", kind: "contextCompaction", role: "tool" },
      { id: "system", kind: "system", role: "system", text: "Disconnected" },
    ]);

    expect(presentation.map(({ semanticKind }) => semanticKind)).toEqual([
      "goalChange",
      "approvalResult",
      "userInputResult",
      "reviewResult",
      "contextCompaction",
      "systemNotice",
    ]);
  });

  it("marks completed proposed plans as implementable turn outcomes", () => {
    const [draft, completed] = presentationClassificationsFromMessageStreamItems([
      { id: "draft", kind: "message", messageKind: "proposedPlan", messageState: "streaming", role: "assistant", text: "draft" },
      { id: "plan", kind: "message", messageKind: "proposedPlan", messageState: "completed", role: "assistant", text: "plan" },
    ]);

    expect(draft).toMatchObject({
      semanticKind: "proposedPlan",
      actions: { canImplementPlan: false, isTurnOutcome: false },
    });
    expect(completed).toMatchObject({
      semanticKind: "proposedPlan",
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
    commandAction: "command",
    commandTarget: { kind: "command", commandLine: "npm test" },
    command: "npm test",
    cwd: "/vault",
    status: "completed",
    executionState: "completed",
  };
}
