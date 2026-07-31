import { describe, expect, it } from "vitest";
import type { ThreadStreamItem } from "../../../../../src/features/chat/domain/thread-stream/items";
import { threadStreamLayoutBlocks as projectThreadStreamLayoutBlocks } from "../../../../../src/features/chat/panel/thread-stream/layout";

const DEFAULT_WORKSPACE_ROOT = "/vault";

function threadStreamLayoutBlocks(
  items: readonly ThreadStreamItem[],
  activeTurnId: string | null,
  workspaceRoot: string,
  turnDiffs: ReadonlyMap<string, string> = new Map(),
): ReturnType<typeof projectThreadStreamLayoutBlocks> {
  return projectThreadStreamLayoutBlocks(items, activeTurnId, workspaceRoot, turnDiffs);
}

function commandItem(id: string, text: string, turnId: string): ThreadStreamItem {
  return {
    id,
    kind: "command",
    role: "tool",
    turnId,
    commandAction: "command",
    commandTarget: { kind: "command", commandLine: text },
    command: text,
    cwd: "/vault",
    status: "completed",
    executionState: "completed",
  };
}

function fileChangeItem(id: string, turnId: string, path = "src/main.ts"): ThreadStreamItem {
  return {
    id,
    kind: "fileChange",
    role: "tool",
    turnId,
    status: "completed",
    executionState: "completed",
    changes: [{ kind: "update", path, diff: "" }],
  };
}

function autoReviewResultItem(id: string, turnId: string, text = "Auto-review approved: npm test"): ThreadStreamItem {
  return {
    id,
    kind: "reviewResult",
    role: "tool",
    text,
    turnId,
    provenance: { source: "appServer", channel: "notification", event: "autoReview", sourceItemId: id },
    executionState: "completed",
  };
}

describe("display block grouping keeps thread stream details subordinate to conversation messages", () => {
  it("groups completed turn activities before the final assistant message", () => {
    const items: ThreadStreamItem[] = [
      { id: "u1", kind: "dialogue", dialogueKind: "user", role: "user", text: "do it", turnId: "t1" },
      { id: "r1", kind: "reasoning", role: "tool", text: "thinking", turnId: "t1" },
      commandItem("c1", "npm test", "t1"),
      {
        id: "a1",
        kind: "dialogue",
        role: "assistant",
        text: "done",
        turnId: "t1",
        dialogueKind: "assistantResponse",
        dialogueState: "completed",
      },
    ];

    const blocks = threadStreamLayoutBlocks(items, null, DEFAULT_WORKSPACE_ROOT);
    expect(blocks.map((block) => block.type)).toEqual(["item", "activityGroup", "item"]);
    expect(blocks[1]).toMatchObject({ summary: "Work details" });
  });

  it("groups completed hook and review logs before the final assistant message", () => {
    const items: ThreadStreamItem[] = [
      { id: "u1", kind: "dialogue", dialogueKind: "user", role: "user", text: "do it", turnId: "t1" },
      {
        id: "hook-1",
        kind: "hook",
        role: "tool",
        text: "userPromptSubmit: Saving jj baseline",
        toolName: "hook",
        turnId: "t1",
        status: "completed",
      },
      commandItem("c1", "npm test", "t1"),
      { id: "r1", kind: "reasoning", role: "tool", text: "thinking", turnId: "t1", status: "completed" },
      autoReviewResultItem("review-1", "t1"),
      autoReviewResultItem("review-2", "t1"),
      {
        id: "a1",
        kind: "dialogue",
        role: "assistant",
        text: "done",
        turnId: "t1",
        dialogueKind: "assistantResponse",
        dialogueState: "completed",
      },
    ];

    const blocks = threadStreamLayoutBlocks(items, null, DEFAULT_WORKSPACE_ROOT);

    expect(blocks.map((block) => (block.type === "item" ? block.item.id : block.id))).toEqual(["u1", "turn-t1-activity", "a1"]);
    expect(blocks[1]).toMatchObject({
      summary: "Work details",
      items: [
        { item: { id: "hook-1" } },
        { item: { id: "c1" } },
        { item: { id: "r1" } },
        { item: { id: "review-1" } },
        { item: { id: "review-2" } },
      ],
    });
    expect(blocks[2]).toMatchObject({
      item: { id: "a1" },
      annotations: { autoReviewSummaries: ["Auto-review approved: npm test", "Auto-review approved: npm test"] },
    });
  });

  it("hides empty completed reasoning items", () => {
    const items: ThreadStreamItem[] = [
      { id: "u1", kind: "dialogue", dialogueKind: "user", role: "user", text: "do it", turnId: "t1" },
      { id: "r1", kind: "reasoning", role: "tool", text: "", turnId: "t1", status: "completed", executionState: "completed" },
      {
        id: "a1",
        kind: "dialogue",
        role: "assistant",
        text: "done",
        turnId: "t1",
        dialogueKind: "assistantResponse",
        dialogueState: "completed",
      },
    ];

    const blocks = threadStreamLayoutBlocks(items, null, DEFAULT_WORKSPACE_ROOT);
    expect(blocks.map((block) => (block.type === "item" ? block.item.id : block.id))).toEqual(["u1", "a1"]);
  });

  it("collapses earlier assistant responses with their turn details", () => {
    const items: ThreadStreamItem[] = [
      { id: "u1", kind: "dialogue", dialogueKind: "user", role: "user", text: "do it", turnId: "t1" },
      {
        id: "a1",
        kind: "dialogue",
        role: "assistant",
        text: "I'll inspect it.",
        turnId: "t1",
        dialogueKind: "assistantResponse",
        dialogueState: "completed",
      },
      commandItem("c1", "rg issue", "t1"),
      {
        id: "a2",
        kind: "dialogue",
        role: "assistant",
        text: "I found the cause.",
        turnId: "t1",
        dialogueKind: "assistantResponse",
        dialogueState: "completed",
      },
      fileChangeItem("f1", "t1"),
      {
        id: "a3",
        kind: "dialogue",
        role: "assistant",
        text: "done",
        turnId: "t1",
        dialogueKind: "assistantResponse",
        dialogueState: "completed",
      },
    ];

    const blocks = threadStreamLayoutBlocks(items, null, DEFAULT_WORKSPACE_ROOT);
    expect(blocks.map((block) => block.type)).toEqual(["item", "activityGroup", "item"]);
    expect(blocks[1]).toMatchObject({
      summary: "Work details",
      items: [{ item: { id: "a1" } }, { item: { id: "c1" } }, { item: { id: "a2" } }, { item: { id: "f1" } }],
    });
    expect(blocks[2]).toMatchObject({ item: { id: "a3" } });
  });

  it("keeps completed turn work details attached to the final response even when system messages are interleaved", () => {
    const items: ThreadStreamItem[] = [
      { id: "s1", kind: "system", role: "system", text: "debug before hook" },
      commandItem("c1", "npm test", "t1"),
      { id: "s2", kind: "system", role: "system", text: "debug after hook" },
      {
        id: "a1",
        kind: "dialogue",
        role: "assistant",
        text: "done",
        turnId: "t1",
        dialogueKind: "assistantResponse",
        dialogueState: "completed",
      },
    ];

    const blocks = threadStreamLayoutBlocks(items, null, DEFAULT_WORKSPACE_ROOT);

    expect(blocks.map((block) => (block.type === "item" ? block.item.id : block.id))).toEqual(["s1", "s2", "turn-t1-activity", "a1"]);
  });

  it("adds steering markers to completed turn work details without hiding the steering message", () => {
    const items: ThreadStreamItem[] = [
      { id: "u1", kind: "dialogue", dialogueKind: "user", role: "user", text: "do it", turnId: "t1" },
      commandItem("c1", "rg issue", "t1"),
      { id: "u2", kind: "dialogue", dialogueKind: "user", role: "user", text: "also check tests", turnId: "t1", clientId: "local-steer-1" },
      commandItem("c2", "npm test", "t1"),
      {
        id: "a1",
        kind: "dialogue",
        role: "assistant",
        text: "done",
        turnId: "t1",
        dialogueKind: "assistantResponse",
        dialogueState: "completed",
      },
    ];

    const blocks = threadStreamLayoutBlocks(items, null, DEFAULT_WORKSPACE_ROOT);

    expect(blocks.map((block) => (block.type === "item" ? block.item.id : block.id))).toEqual(["u1", "u2", "turn-t1-activity", "a1"]);
    expect(blocks[2]).toMatchObject({
      summary: "Work details",
      items: [
        { type: "item", item: { id: "c1" } },
        {
          type: "steering",
          id: "steer-activity-u2",
          label: "steering",
          text: "also check tests",
          sourceItemId: "u2",
        },
        { type: "item", item: { id: "c2" } },
      ],
    });
  });

  it("keeps multiple steering markers in completed turn work details", () => {
    const items: ThreadStreamItem[] = [
      { id: "u1", kind: "dialogue", dialogueKind: "user", role: "user", text: "do it", turnId: "t1" },
      { id: "u2", kind: "dialogue", dialogueKind: "user", role: "user", text: "also check tests", turnId: "t1" },
      { id: "u3", kind: "dialogue", dialogueKind: "user", role: "user", text: "and update docs", turnId: "t1" },
      {
        id: "a1",
        kind: "dialogue",
        role: "assistant",
        text: "done",
        turnId: "t1",
        dialogueKind: "assistantResponse",
        dialogueState: "completed",
      },
    ];

    const blocks = threadStreamLayoutBlocks(items, null, DEFAULT_WORKSPACE_ROOT);
    const activityGroup = blocks.find((block) => block.type === "activityGroup");

    expect(activityGroup).toMatchObject({
      summary: "Work details",
      items: [
        { type: "steering", id: "steer-activity-u2" },
        { type: "steering", id: "steer-activity-u3" },
      ],
    });
  });

  it("keeps active turn activities expanded", () => {
    const items: ThreadStreamItem[] = [
      { id: "r1", kind: "reasoning", role: "tool", text: "thinking", turnId: "t1" },
      {
        id: "a1",
        kind: "dialogue",
        role: "assistant",
        text: "done",
        turnId: "t1",
        dialogueKind: "assistantResponse",
        dialogueState: "completed",
      },
    ];

    expect(threadStreamLayoutBlocks(items, "t1", DEFAULT_WORKSPACE_ROOT).map((block) => block.type)).toEqual(["item", "item"]);
  });

  it("keeps active task progress chronological in the display model", () => {
    const items: ThreadStreamItem[] = [
      { id: "u1", kind: "dialogue", dialogueKind: "user", role: "user", text: "do it", turnId: "t1" },
      {
        id: "plan-progress-t1",
        kind: "taskProgress",
        role: "tool",
        text: "[>] Patch UI",
        turnId: "t1",
        explanation: null,
        steps: [{ step: "Patch UI", status: "inProgress" }],
        status: "inProgress",
      },
      {
        id: "a1",
        kind: "dialogue",
        role: "assistant",
        text: "working",
        turnId: "t1",
        dialogueKind: "assistantResponse",
        dialogueState: "completed",
      },
    ];

    const blocks = threadStreamLayoutBlocks(items, "t1", DEFAULT_WORKSPACE_ROOT);

    expect(blocks.map((block) => (block.type === "item" ? block.item.id : block.id))).toEqual(["u1", "plan-progress-t1", "a1"]);
  });

  it("groups task progress and agent activity inside completed turn work details", () => {
    const items: ThreadStreamItem[] = [
      { id: "u1", kind: "dialogue", dialogueKind: "user", role: "user", text: "do it", turnId: "t1" },
      {
        id: "plan-progress-t1",
        kind: "taskProgress",
        role: "tool",
        text: "[>] Patch UI",
        turnId: "t1",
        explanation: null,
        steps: [{ step: "Patch UI", status: "inProgress" }],
        status: "inProgress",
      },
      {
        id: "agent-1",
        kind: "agent",
        role: "tool",
        coordinationUpdate: "snapshot",
        text: "Spawn agent",
        turnId: "t1",
        action: "spawn",
        status: "completed",
        senderThreadId: "parent",
        targets: [{ threadId: "child" }],
        prompt: null,
        model: null,
        reasoningEffort: null,
        agents: [{ threadId: "child", status: "completed", executionState: "completed", message: null }],
      },
      {
        id: "a1",
        kind: "dialogue",
        role: "assistant",
        text: "done",
        turnId: "t1",
        dialogueKind: "assistantResponse",
        dialogueState: "completed",
      },
    ];

    const blocks = threadStreamLayoutBlocks(items, null, DEFAULT_WORKSPACE_ROOT);
    expect(blocks[1]).toMatchObject({
      summary: "Work details",
      items: [{ item: { id: "plan-progress-t1" } }, { item: { id: "agent-1" } }],
    });
  });

  it("adds edited files to the final assistant message", () => {
    const items: ThreadStreamItem[] = [
      fileChangeItem("f1", "t1", "src/main.ts"),
      fileChangeItem("f2", "t1", "styles.css"),
      {
        id: "a1",
        kind: "dialogue",
        role: "assistant",
        text: "intermediate",
        turnId: "t1",
        dialogueKind: "assistantResponse",
        dialogueState: "completed",
      },
      {
        id: "a2",
        kind: "dialogue",
        role: "assistant",
        text: "done",
        turnId: "t1",
        dialogueKind: "assistantResponse",
        dialogueState: "completed",
      },
    ];

    const assistantBlock = threadStreamLayoutBlocks(items, null, DEFAULT_WORKSPACE_ROOT).find(
      (block) => block.type === "item" && block.item.role === "assistant",
    );
    expect(assistantBlock).toMatchObject({ annotations: { editedFiles: ["src/main.ts", "styles.css"] } });
  });

  it("adds turn diff metadata to the final assistant message only when aggregated diff exists", () => {
    const items: ThreadStreamItem[] = [
      fileChangeItem("f1", "t1", "src/main.ts"),
      {
        id: "a1",
        kind: "dialogue",
        role: "assistant",
        text: "done",
        turnId: "t1",
        dialogueKind: "assistantResponse",
        dialogueState: "completed",
      },
    ];

    const withoutDiff = threadStreamLayoutBlocks(items, null, DEFAULT_WORKSPACE_ROOT).find(
      (block) => block.type === "item" && block.item.role === "assistant",
    );
    expect(withoutDiff).toMatchObject({ annotations: { editedFiles: ["src/main.ts"] } });
    expect(withoutDiff?.type === "item" ? withoutDiff.annotations : null).not.toHaveProperty("turnDiff");

    const withDiff = threadStreamLayoutBlocks(items, null, DEFAULT_WORKSPACE_ROOT, new Map([["t1", "@@\n-old\n+new"]])).find(
      (block) => block.type === "item" && block.item.role === "assistant",
    );
    expect(withDiff).toMatchObject({ annotations: { editedFiles: ["src/main.ts"], turnDiff: { diff: "@@\n-old\n+new" } } });
  });

  it("adds auto-review summaries to the final assistant message", () => {
    const items: ThreadStreamItem[] = [
      autoReviewResultItem("review-1", "t1"),
      autoReviewResultItem("review-2", "t1"),
      {
        id: "a1",
        kind: "dialogue",
        role: "assistant",
        text: "done",
        turnId: "t1",
        dialogueKind: "assistantResponse",
        dialogueState: "completed",
      },
    ];

    const assistantBlock = threadStreamLayoutBlocks(items, null, DEFAULT_WORKSPACE_ROOT).find(
      (block) => block.type === "item" && block.item.role === "assistant",
    );
    expect(assistantBlock).toMatchObject({
      annotations: { autoReviewSummaries: ["Auto-review approved: npm test", "Auto-review approved: npm test"] },
    });
  });

  it("does not add edited file or auto-review summaries to active turn messages", () => {
    const items: ThreadStreamItem[] = [
      fileChangeItem("f1", "t1", "src/main.ts"),
      autoReviewResultItem("review-1", "t1"),
      {
        id: "a1",
        kind: "dialogue",
        role: "assistant",
        text: "still working",
        turnId: "t1",
        dialogueKind: "assistantResponse",
        dialogueState: "completed",
      },
    ];

    const assistantBlock = threadStreamLayoutBlocks(items, "t1", DEFAULT_WORKSPACE_ROOT).find(
      (block) => block.type === "item" && block.item.id === "a1",
    );
    expect(assistantBlock?.type === "item" ? assistantBlock.annotations : null).toBeUndefined();
  });
});

describe("workspace-relative presentation paths", () => {
  it("shows edited files relative to the workspace root", () => {
    const items: ThreadStreamItem[] = [
      fileChangeItem("f1", "t1", "/vault/project/src/main.ts"),
      fileChangeItem("f2", "t1", "/vault/project/styles.css"),
      fileChangeItem("f3", "t1", "/tmp/outside.txt"),
      {
        id: "a1",
        kind: "dialogue",
        role: "assistant",
        text: "done",
        turnId: "t1",
        dialogueKind: "assistantResponse",
        dialogueState: "completed",
      },
    ];

    const assistantBlock = threadStreamLayoutBlocks(items, null, "/vault/project").find(
      (block) => block.type === "item" && block.item.role === "assistant",
    );
    expect(assistantBlock).toMatchObject({ annotations: { editedFiles: ["/tmp/outside.txt", "src/main.ts", "styles.css"] } });
  });
});
