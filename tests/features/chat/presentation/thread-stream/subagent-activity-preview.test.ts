import { describe, expect, it } from "vitest";
import type { ThreadStreamItem } from "../../../../../src/features/chat/domain/thread-stream/items";
import { subagentActivityPreview } from "../../../../../src/features/chat/presentation/thread-stream/subagent-activity-preview";

describe("subagent activity preview", () => {
  it("shows streamed reasoning without its transport label", () => {
    expect(
      subagentActivityPreview({
        id: "reasoning",
        kind: "reasoning",
        role: "tool",
        text: "reasoning: Inspecting notification routing",
      }),
    ).toBe("Inspecting notification routing");
  });

  it("prefers the active task step", () => {
    expect(
      subagentActivityPreview({
        id: "tasks",
        kind: "taskProgress",
        role: "tool",
        explanation: "Implementation plan",
        steps: [
          { step: "Read code", status: "completed" },
          { step: "Patch notification routing", status: "inProgress" },
        ],
        status: "inProgress",
      }),
    ).toBe("Patch notification routing");
  });

  it("reuses the compact command target summary", () => {
    expect(
      subagentActivityPreview({
        id: "command",
        kind: "command",
        role: "tool",
        commandAction: "search",
        commandTarget: { kind: "search", query: "inactive", path: "/vault/src" },
        command: 'rg "inactive" src',
        cwd: "/vault",
        status: "inProgress",
      }),
    ).toBe("inactive in src");
  });

  it("uses the first non-empty assistant line and omits user items", () => {
    const assistant: ThreadStreamItem = {
      id: "answer",
      kind: "dialogue",
      dialogueKind: "assistantResponse",
      dialogueState: "completed",
      role: "assistant",
      text: "\n  Tests are passing.  \nMore detail",
    };
    const user: ThreadStreamItem = {
      id: "prompt",
      kind: "dialogue",
      dialogueKind: "user",
      role: "user",
      text: "Do the work",
    };

    expect(subagentActivityPreview(assistant)).toBe("Tests are passing.");
    expect(subagentActivityPreview(user)).toBeNull();
  });
});
