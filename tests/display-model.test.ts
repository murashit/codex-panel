import { describe, expect, it } from "vitest";

import {
  appendAssistantDelta,
  activeAgentRunSummary,
  appendItemOutput,
  appendItemText,
  appendPlanDelta,
  appendToolOutput,
  createAutoReviewResultItem,
  createReviewResultItem,
  displayBlocksForItems,
  displayItemFromThreadItem,
  displayItemsFromTurns,
  executionState,
  normalizeProposedPlanMarkdown,
  planProgressDisplayItem,
  upsertDisplayItem,
} from "../src/display/model";
import type { DisplayItem } from "../src/display/types";
import type { ThreadItem } from "../src/generated/app-server/v2/ThreadItem";
import type { Turn } from "../src/generated/app-server/v2/Turn";

function commandItem(id: string, text: string, turnId: string): DisplayItem {
  return { id, kind: "command", role: "tool", text, turnId, command: text, cwd: "/vault", status: "completed" };
}

function fileChangeItem(id: string, turnId: string, path = "src/main.ts"): DisplayItem {
  return {
    id,
    kind: "fileChange",
    role: "tool",
    text: "File change completed",
    turnId,
    status: "completed",
    changes: [{ kind: "update", path, diff: "" }],
  };
}

describe("display model", () => {
  it("sorts turns oldest first and converts messages", () => {
    const userMessage: ThreadItem = { type: "userMessage", id: "u1", content: [{ type: "text", text: "hello", text_elements: [] }] };
    const assistantMessage: ThreadItem = { type: "agentMessage", id: "a1", text: "world", phase: null, memoryCitation: null };
    const turns: Turn[] = [
      {
        id: "new",
        items: [assistantMessage],
        itemsView: "full",
        status: "completed",
        startedAt: 2,
        completedAt: 3,
        durationMs: 1,
        error: null,
      },
      { id: "old", items: [userMessage], itemsView: "full", status: "completed", startedAt: 1, completedAt: 2, durationMs: 1, error: null },
    ];

    expect(displayItemsFromTurns(turns).map((item) => item.text)).toEqual(["hello", "world"]);
    expect(displayItemFromThreadItem(userMessage)).toMatchObject({ role: "user", markdown: true });
  });

  it("preserves reasoning text", () => {
    const item: ThreadItem = { type: "reasoning", id: "r1", summary: ["summary"], content: ["detail"] };
    expect(displayItemFromThreadItem(item)?.text).toBe("summary\n\ndetail");
  });

  it("keeps empty reasoning text empty so completed placeholders can be hidden", () => {
    const item: ThreadItem = { type: "reasoning", id: "r1", summary: [], content: [] };
    expect(displayItemFromThreadItem(item)?.text).toBe("");
  });

  it("renders completed plan items as assistant markdown", () => {
    const item: ThreadItem = { type: "plan", id: "p1", text: "<proposed_plan>\n# Plan\n</proposed_plan>" };
    expect(displayItemFromThreadItem(item, "t1")).toMatchObject({
      id: "p1",
      kind: "message",
      role: "assistant",
      text: "# Plan",
      markdown: true,
      turnId: "t1",
    });
  });

  it("normalizes proposed plan wrappers before markdown rendering", () => {
    expect(normalizeProposedPlanMarkdown("<proposed_plan>\n## Summary\n- Ship it\n</proposed_plan>")).toBe("## Summary\n- Ship it");
  });

  it("streams plan deltas as plain assistant text until completion", () => {
    const items = appendPlanDelta([], "p1", "t1", "<proposed_plan>\n# Plan");
    const updated = appendPlanDelta(items, "p1", "t1", "\n</proposed_plan>");
    expect(updated).toMatchObject([{ id: "p1", kind: "message", role: "assistant", text: "# Plan", markdown: false }]);
  });

  it("formats structured plan progress as task progress", () => {
    expect(
      planProgressDisplayItem("t1", "Working plan", [
        { step: "Inspect code", status: "completed" },
        { step: "Patch UI", status: "inProgress" },
        { step: "Run tests", status: "pending" },
      ]),
    ).toMatchObject({
      id: "plan-progress-t1",
      kind: "taskProgress",
      role: "tool",
      text: "Working plan\n[x] Inspect code\n[>] Patch UI\n[ ] Run tests",
      explanation: "Working plan",
      steps: [
        { step: "Inspect code", status: "completed" },
        { step: "Patch UI", status: "inProgress" },
        { step: "Run tests", status: "pending" },
      ],
      status: "inProgress",
    });
  });

  it("formats collab agent tool calls as agent activity", () => {
    const item: ThreadItem = {
      type: "collabAgentToolCall",
      id: "agent-1",
      tool: "spawnAgent",
      status: "completed",
      senderThreadId: "parent-thread",
      receiverThreadIds: ["child-thread"],
      prompt: "Inspect the renderer.",
      model: "gpt-5.5",
      reasoningEffort: "high",
      agentsStates: { "child-thread": { status: "completed", message: "Done" } },
    };

    expect(displayItemFromThreadItem(item, "t1")).toMatchObject({
      id: "agent-1",
      kind: "agent",
      role: "tool",
      tool: "spawnAgent",
      status: "completed",
      senderThreadId: "parent-thread",
      receiverThreadIds: ["child-thread"],
      prompt: "Inspect the renderer.",
      model: "gpt-5.5",
      reasoningEffort: "high",
      agents: [{ threadId: "child-thread", status: "completed", message: "Done" }],
      state: "completed",
    });
  });

  it("keeps spawned agents running until child state completes", () => {
    const item: ThreadItem = {
      type: "collabAgentToolCall",
      id: "agent-1",
      tool: "spawnAgent",
      status: "completed",
      senderThreadId: "parent-thread",
      receiverThreadIds: ["child-thread"],
      prompt: "Inspect the renderer.",
      model: null,
      reasoningEffort: null,
      agentsStates: {},
    };

    expect(displayItemFromThreadItem(item, "t1")).toMatchObject({
      kind: "agent",
      status: "completed",
      state: "running",
    });
  });

  it("summarizes command items without exposing output inline", () => {
    const item: ThreadItem = {
      type: "commandExecution",
      id: "cmd-1",
      command: "npm run check",
      cwd: "/vault",
      processId: null,
      source: "agent",
      status: "failed",
      commandActions: [{ type: "unknown", command: "npm" }],
      aggregatedOutput: "stderr with many details",
      exitCode: 1,
      durationMs: 42,
    };

    expect(displayItemFromThreadItem(item, "t1")).toMatchObject({
      kind: "command",
      text: "npm run check (exit 1)",
      output: "stderr with many details",
      state: "failed",
    });
  });

  it("labels parsed read commands separately from generic commands", () => {
    const item: ThreadItem = {
      type: "commandExecution",
      id: "cmd-1",
      command: "sed -n '1,20p' src/main.ts",
      cwd: "/vault",
      processId: null,
      source: "agent",
      status: "completed",
      commandActions: [{ type: "read", command: "sed", name: "main.ts", path: "/vault/src/main.ts" }],
      aggregatedOutput: "file contents",
      exitCode: 0,
      durationMs: 10,
    };

    expect(displayItemFromThreadItem(item, "t1")).toMatchObject({
      kind: "command",
      actionLabel: "read",
      text: "src/main.ts",
      state: "completed",
    });
  });

  it("summarizes piped parsed read commands by file name only", () => {
    const item: ThreadItem = {
      type: "commandExecution",
      id: "cmd-1",
      command: "nl -ba src/main.ts | sed -n '1,20p'",
      cwd: "/vault",
      processId: null,
      source: "agent",
      status: "completed",
      commandActions: [{ type: "read", command: "nl", name: "main.ts", path: "/vault/src/main.ts" }],
      aggregatedOutput: "numbered file contents",
      exitCode: 0,
      durationMs: 10,
    };

    expect(displayItemFromThreadItem(item, "t1")).toMatchObject({
      kind: "command",
      actionLabel: "read",
      text: "src/main.ts",
      command: "nl -ba src/main.ts | sed -n '1,20p'",
      cwd: "/vault",
      state: "completed",
    });
  });

  it("keeps absolute read paths when they are outside the command cwd", () => {
    const item: ThreadItem = {
      type: "commandExecution",
      id: "cmd-1",
      command: "sed -n '1,20p' /vault/src/main.ts",
      cwd: "/vault/tests",
      processId: null,
      source: "agent",
      status: "completed",
      commandActions: [{ type: "read", command: "sed", name: "main.ts", path: "/vault/src/main.ts" }],
      aggregatedOutput: "file contents",
      exitCode: 0,
      durationMs: 10,
    };

    expect(displayItemFromThreadItem(item, "t1")).toMatchObject({
      kind: "command",
      actionLabel: "read",
      text: "/vault/src/main.ts",
      state: "completed",
    });
  });

  it("summarizes zsh login wrapper commands without changing their command classification", () => {
    const item: ThreadItem = {
      type: "commandExecution",
      id: "cmd-1",
      command: "/bin/zsh -lc 'npm run check'",
      cwd: "/vault",
      processId: null,
      source: "agent",
      status: "completed",
      commandActions: [{ type: "unknown", command: "zsh" }],
      aggregatedOutput: "check output",
      exitCode: 0,
      durationMs: 10,
    };

    expect(displayItemFromThreadItem(item, "t1")).toMatchObject({
      kind: "command",
      actionLabel: "command",
      text: "npm run check",
      command: "/bin/zsh -lc 'npm run check'",
      cwd: "/vault",
      state: "completed",
    });
  });

  it("labels parsed search commands and summarizes their query and path", () => {
    const item: ThreadItem = {
      type: "commandExecution",
      id: "cmd-1",
      command: "rg 'command target' src/display",
      cwd: "/vault",
      processId: null,
      source: "agent",
      status: "completed",
      commandActions: [{ type: "search", command: "rg", query: "command target", path: "src/display" }],
      aggregatedOutput: "search results",
      exitCode: 0,
      durationMs: 10,
    };

    expect(displayItemFromThreadItem(item, "t1")).toMatchObject({
      kind: "command",
      actionLabel: "search",
      text: '"command target" in src/display',
      command: "rg 'command target' src/display",
      cwd: "/vault",
      state: "completed",
    });
  });

  it("labels parsed file listing commands and summarizes their path", () => {
    const item: ThreadItem = {
      type: "commandExecution",
      id: "cmd-1",
      command: "rg --files src/display",
      cwd: "/vault",
      processId: null,
      source: "agent",
      status: "completed",
      commandActions: [{ type: "listFiles", command: "rg", path: "src/display" }],
      aggregatedOutput: "src/display/model.ts",
      exitCode: 0,
      durationMs: 10,
    };

    expect(displayItemFromThreadItem(item, "t1")).toMatchObject({
      kind: "command",
      actionLabel: "list files",
      text: "src/display",
      state: "completed",
    });
  });

  it("uses the representative command action for both label and summary", () => {
    const item: ThreadItem = {
      type: "commandExecution",
      id: "cmd-1",
      command: "cd src && rg target",
      cwd: "/vault",
      processId: null,
      source: "agent",
      status: "completed",
      commandActions: [
        { type: "unknown", command: "cd" },
        { type: "search", command: "rg", query: "target", path: "src" },
      ],
      aggregatedOutput: "search results",
      exitCode: 0,
      durationMs: 10,
    };

    expect(displayItemFromThreadItem(item, "t1")).toMatchObject({
      kind: "command",
      actionLabel: "search",
      text: "target in src",
      state: "completed",
    });
  });

  it("summarizes parsed workspace file listings without a path", () => {
    const item: ThreadItem = {
      type: "commandExecution",
      id: "cmd-1",
      command: "rg --files",
      cwd: "/vault",
      processId: null,
      source: "agent",
      status: "completed",
      commandActions: [{ type: "listFiles", command: "rg", path: null }],
      aggregatedOutput: "README.md",
      exitCode: 0,
      durationMs: 10,
    };

    expect(displayItemFromThreadItem(item, "t1")).toMatchObject({
      kind: "command",
      actionLabel: "list files",
      text: "workspace",
      state: "completed",
    });
  });

  it("does not infer failed command summaries from stdout or stderr text", () => {
    const item: ThreadItem = {
      type: "commandExecution",
      id: "cmd-1",
      command: "rg error src",
      cwd: "/vault",
      processId: null,
      source: "agent",
      status: "completed",
      commandActions: [{ type: "unknown", command: "rg" }],
      aggregatedOutput: "error appears as search result text",
      exitCode: 0,
      durationMs: null,
    };

    expect(displayItemFromThreadItem(item, "t1")).toMatchObject({
      kind: "command",
      text: "rg error src",
      state: "completed",
    });
  });

  it("omits running qualifiers from command, file change, and tool summaries", () => {
    const command: ThreadItem = {
      type: "commandExecution",
      id: "cmd-1",
      command: "npm run check",
      cwd: "/vault",
      processId: null,
      source: "agent",
      status: "inProgress",
      commandActions: [{ type: "unknown", command: "npm" }],
      aggregatedOutput: null,
      exitCode: null,
      durationMs: null,
    };
    const fileChange: ThreadItem = {
      type: "fileChange",
      id: "patch-1",
      status: "inProgress",
      changes: [{ kind: { type: "update", move_path: null }, path: "src/main.ts", diff: "@@\n-old\n+new" }],
    };
    const tool: ThreadItem = {
      type: "mcpToolCall",
      id: "mcp-1",
      server: "github",
      tool: "pull_request_read",
      status: "inProgress",
      arguments: { id: 123 },
      result: null,
      error: null,
      durationMs: null,
    };

    expect(displayItemFromThreadItem(command, "t1")).toMatchObject({
      text: "npm run check",
      state: "running",
    });
    expect(displayItemFromThreadItem(fileChange, "t1")).toMatchObject({
      text: "src/main.ts",
      state: "running",
    });
    expect(displayItemFromThreadItem(tool, "t1")).toMatchObject({
      text: "123",
      toolLabel: "github.pull_request_read",
      state: "running",
    });
  });

  it("summarizes MCP tool calls from structured arguments and errors", () => {
    const item: ThreadItem = {
      type: "mcpToolCall",
      id: "mcp-1",
      server: "github",
      tool: "pull_request_read",
      status: "failed",
      arguments: { owner: "org", repo: "project", id: 123 },
      result: null,
      error: { message: "Not found" },
      durationMs: 10,
    };

    expect(displayItemFromThreadItem(item, "t1")).toMatchObject({
      kind: "tool",
      text: "123 (Not found)",
      toolLabel: "github.pull_request_read",
      details: [
        { title: "Arguments JSON", body: expect.stringContaining('"id": 123') },
        { title: "Error JSON", body: expect.stringContaining("Not found") },
      ],
      state: "failed",
    });
  });

  it("summarizes dynamic tool calls from structured arguments only", () => {
    const item: ThreadItem = {
      type: "dynamicToolCall",
      id: "tool-1",
      namespace: "web",
      tool: "open",
      arguments: { url: "https://example.com" },
      status: "completed",
      contentItems: [{ type: "inputText", text: "ok" }],
      success: true,
      durationMs: 10,
    };

    expect(displayItemFromThreadItem(item, "t1")).toMatchObject({
      kind: "tool",
      text: "https://example.com",
      toolLabel: "web.open",
      details: [
        { title: "Arguments JSON", body: expect.stringContaining("https://example.com") },
        { title: "Result JSON", body: expect.stringContaining("ok") },
      ],
      state: "completed",
    });
  });

  it("uses details as the summary when a tool target cannot be extracted", () => {
    const item: ThreadItem = {
      type: "dynamicToolCall",
      id: "tool-1",
      namespace: "multi_tool_use",
      tool: "parallel",
      arguments: {},
      status: "completed",
      contentItems: null,
      success: true,
      durationMs: 10,
    };

    expect(displayItemFromThreadItem(item, "t1")).toMatchObject({
      kind: "tool",
      text: "details",
      toolLabel: "multi_tool_use.parallel",
      state: "completed",
    });
  });

  it("summarizes web search actions by action type and target", () => {
    const item: ThreadItem = {
      type: "webSearch",
      id: "search-1",
      query: "fallback query",
      action: { type: "search", query: "codex app-server", queries: ["obsidian codex panel"] },
    };

    expect(displayItemFromThreadItem(item, "t1")).toMatchObject({
      kind: "tool",
      text: "search: codex app-server; obsidian codex panel; fallback query",
      toolLabel: "web search",
      details: [
        {
          title: "web search",
          rows: [
            { key: "action", value: "search" },
            { key: "query", value: "codex app-server; obsidian codex panel; fallback query" },
          ],
        },
      ],
    });
  });

  it("structures automatic approval review summary messages", () => {
    expect(
      createReviewResultItem(
        "Automatic approval review approved (risk: low, authorization: unknown): Auto-review returned a low-risk allow decision.",
      ),
    ).toMatchObject({
      kind: "reviewResult",
      text: "Auto-review approved: Auto-review returned a low-risk allow decision.",
      state: "completed",
      details: [
        {
          title: "Review",
          rows: [
            { key: "status", value: "approved" },
            { key: "risk", value: "low" },
            { key: "authorization", value: "unknown" },
            { key: "message", value: "Auto-review returned a low-risk allow decision." },
          ],
        },
      ],
    });
  });

  it("structures automatic approval review actions as metadata rows", () => {
    expect(
      createAutoReviewResultItem({
        threadId: "thread",
        turnId: "turn",
        startedAtMs: 1,
        completedAtMs: 2,
        reviewId: "review-1",
        targetItemId: "patch-1",
        decisionSource: "agent",
        review: { status: "approved", riskLevel: "low", userAuthorization: "medium", rationale: "Allowed by policy." },
        action: { type: "applyPatch", cwd: "/vault", files: ["/vault/src/display/model.ts", "/vault/tests/display-model.test.ts"] },
      }),
    ).toMatchObject({
      kind: "reviewResult",
      text: "Auto-review approved: apply patch (2 files)",
      details: [
        {
          title: "Review",
          rows: expect.arrayContaining([
            { key: "action", value: "apply patch" },
            { key: "cwd", value: "/vault" },
            { key: "files", value: "/vault/src/display/model.ts\n/vault/tests/display-model.test.ts" },
          ]),
        },
      ],
    });
  });

  it("upserts assistant deltas by item id, not by last position", () => {
    const items: DisplayItem[] = [
      { id: "a1", itemId: "a1", kind: "message", role: "assistant", text: "hello" },
      { id: "tool1", itemId: "tool1", kind: "tool", role: "tool", text: "tool" },
    ];

    const updated = appendAssistantDelta(items, "a1", "t1", " world");
    expect(updated[0].text).toBe("hello world");
    expect(updated).toHaveLength(2);
    expect(items[0].text).toBe("hello");
    expect(updated).not.toBe(items);
  });

  it("appends tool text and output without mutating existing display items", () => {
    const tool: DisplayItem = { id: "tool1", itemId: "tool1", kind: "tool", role: "tool", text: "plan: " };
    const command: DisplayItem = {
      id: "cmd1",
      itemId: "cmd1",
      kind: "command",
      role: "tool",
      text: "Command running",
      command: "npm test",
      cwd: "/vault",
      status: "running",
      output: "one",
    };

    const withText = appendItemText([tool], "tool1", "t1", "plan", "two");
    const withOutput = appendItemOutput([command], "cmd1", "t1", "two", "command", "Command running");
    const withToolOutput = appendToolOutput([tool], "tool1", "t1", "progress", "mcp progress");

    expect(withText[0]).toMatchObject({ text: "plan: two" });
    expect(withOutput[0]).toMatchObject({ output: "onetwo" });
    expect(withToolOutput[0]).toMatchObject({ text: "plan: ", output: "progress" });
    expect(tool.text).toBe("plan: ");
    expect(command.output).toBe("one");
  });

  it("groups completed turn activities before the final assistant message", () => {
    const items: DisplayItem[] = [
      { id: "u1", kind: "message", role: "user", text: "do it", turnId: "t1" },
      { id: "r1", kind: "reasoning", role: "tool", text: "thinking", turnId: "t1" },
      commandItem("c1", "npm test", "t1"),
      { id: "a1", kind: "message", role: "assistant", text: "done", turnId: "t1" },
    ];

    const blocks = displayBlocksForItems(items, null);
    expect(blocks.map((block) => block.type)).toEqual(["item", "activityGroup", "item"]);
    expect(blocks[1]).toMatchObject({ summary: "Work details: command, thought" });
  });

  it("hides empty completed reasoning items", () => {
    const items: DisplayItem[] = [
      { id: "u1", kind: "message", role: "user", text: "do it", turnId: "t1" },
      { id: "r1", kind: "reasoning", role: "tool", text: "", turnId: "t1", status: "completed" },
      { id: "a1", kind: "message", role: "assistant", text: "done", turnId: "t1" },
    ];

    const blocks = displayBlocksForItems(items, null);
    expect(blocks.map((block) => (block.type === "item" ? block.item.id : block.id))).toEqual(["u1", "a1"]);
  });

  it("collapses earlier assistant responses with their turn details", () => {
    const items: DisplayItem[] = [
      { id: "u1", kind: "message", role: "user", text: "do it", turnId: "t1" },
      { id: "a1", kind: "message", role: "assistant", text: "I'll inspect it.", turnId: "t1" },
      commandItem("c1", "rg issue", "t1"),
      { id: "a2", kind: "message", role: "assistant", text: "I found the cause.", turnId: "t1" },
      fileChangeItem("f1", "t1"),
      { id: "a3", kind: "message", role: "assistant", text: "done", turnId: "t1" },
    ];

    const blocks = displayBlocksForItems(items, null);
    expect(blocks.map((block) => block.type)).toEqual(["item", "activityGroup", "item"]);
    expect(blocks[1]).toMatchObject({
      summary: "Work details: 2 responses, command, file change",
      items: [{ id: "a1" }, { id: "c1" }, { id: "a2" }, { id: "f1" }],
    });
    expect(blocks[2]).toMatchObject({ item: { id: "a3" } });
  });

  it("keeps active turn activities expanded", () => {
    const items: DisplayItem[] = [
      { id: "r1", kind: "reasoning", role: "tool", text: "thinking", turnId: "t1" },
      { id: "a1", kind: "message", role: "assistant", text: "done", turnId: "t1" },
    ];

    expect(displayBlocksForItems(items, "t1").map((block) => block.type)).toEqual(["item", "item"]);
  });

  it("moves active task progress to the end of the live turn", () => {
    const items: DisplayItem[] = [
      { id: "u1", kind: "message", role: "user", text: "do it", turnId: "t1" },
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
      { id: "a1", kind: "message", role: "assistant", text: "working", turnId: "t1" },
    ];

    const blocks = displayBlocksForItems(items, "t1");

    expect(blocks.map((block) => (block.type === "item" ? block.item.id : block.id))).toEqual(["u1", "a1", "plan-progress-t1"]);
  });

  it("summarizes task progress and agent activity separately from tools", () => {
    const items: DisplayItem[] = [
      { id: "u1", kind: "message", role: "user", text: "do it", turnId: "t1" },
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
        text: "Spawn agent",
        turnId: "t1",
        tool: "spawnAgent",
        status: "completed",
        senderThreadId: "parent",
        receiverThreadIds: ["child"],
        prompt: null,
        model: null,
        reasoningEffort: null,
        agents: [{ threadId: "child", status: "completed", message: null }],
      },
      { id: "a1", kind: "message", role: "assistant", text: "done", turnId: "t1" },
    ];

    const blocks = displayBlocksForItems(items, null);
    expect(blocks[1]).toMatchObject({ summary: "Work details: task progress, agent" });
  });

  it("summarizes active subagent states while a turn is running", () => {
    const items: DisplayItem[] = [
      {
        id: "agent-1",
        kind: "agent",
        role: "tool",
        text: "Wait for agent",
        turnId: "t1",
        tool: "wait",
        status: "running",
        senderThreadId: "parent",
        receiverThreadIds: ["done", "running", "failed"],
        prompt: null,
        model: null,
        reasoningEffort: null,
        agents: [
          { threadId: "done", status: "completed", message: null },
          { threadId: "running", status: "running", message: null },
          { threadId: "failed", status: "errored", message: null },
        ],
      },
    ];

    expect(activeAgentRunSummary(items, "t1", true)).toEqual({
      running: 1,
      completed: 1,
      failed: 1,
      agents: [
        { threadId: "failed", status: "errored", messagePreview: null },
        { threadId: "running", status: "running", messagePreview: null },
        { threadId: "done", status: "completed", messagePreview: null },
      ],
      additionalAgents: 0,
    });
    expect(activeAgentRunSummary(items, "t1", false)).toBeNull();
  });

  it("summarizes active subagent previews and fallback receiver states", () => {
    const items: DisplayItem[] = [
      {
        id: "agent-1",
        kind: "agent",
        role: "tool",
        text: "Spawn agent",
        turnId: "t1",
        tool: "spawnAgent",
        status: "inProgress",
        senderThreadId: "parent",
        receiverThreadIds: ["fallback-child"],
        prompt: null,
        model: null,
        reasoningEffort: null,
        agents: [],
      },
      {
        id: "agent-2",
        kind: "agent",
        role: "tool",
        text: "Wait for agent",
        turnId: "t1",
        tool: "wait",
        status: "running",
        senderThreadId: "parent",
        receiverThreadIds: ["a", "b", "c"],
        prompt: null,
        model: null,
        reasoningEffort: null,
        agents: [
          { threadId: "a", status: "running", message: "\n  Inspecting   renderer   tests  \nmore details" },
          { threadId: "b", status: "failed", message: "Could not reproduce" },
          { threadId: "c", status: "running", message: null },
        ],
      },
    ];

    expect(activeAgentRunSummary(items, "t1", true)).toMatchObject({
      running: 3,
      completed: 0,
      failed: 1,
      agents: [
        { threadId: "b", status: "failed", messagePreview: "Could not reproduce" },
        { threadId: "a", status: "running", messagePreview: "Inspecting renderer tests" },
        { threadId: "c", status: "running", messagePreview: null },
      ],
      additionalAgents: 1,
    });
  });

  it("omits active subagent summaries once every subagent is complete", () => {
    const items: DisplayItem[] = [
      {
        id: "agent-1",
        kind: "agent",
        role: "tool",
        text: "Wait for agent",
        turnId: "t1",
        tool: "wait",
        status: "completed",
        senderThreadId: "parent",
        receiverThreadIds: ["done"],
        prompt: null,
        model: null,
        reasoningEffort: null,
        agents: [{ threadId: "done", status: "completed", message: null }],
      },
    ];

    expect(activeAgentRunSummary(items, "t1", true)).toBeNull();
  });

  it("adds edited files to the final assistant message", () => {
    const items: DisplayItem[] = [
      fileChangeItem("f1", "t1", "src/main.ts"),
      fileChangeItem("f2", "t1", "styles.css"),
      { id: "a1", kind: "message", role: "assistant", text: "intermediate", turnId: "t1" },
      { id: "a2", kind: "message", role: "assistant", text: "done", turnId: "t1" },
    ];

    const assistantBlock = displayBlocksForItems(items, null).find((block) => block.type === "item" && block.item.role === "assistant");
    expect(assistantBlock).toMatchObject({ item: { editedFiles: ["src/main.ts", "styles.css"] } });
  });

  it("shows edited files relative to the workspace root", () => {
    const items: DisplayItem[] = [
      fileChangeItem("f1", "t1", "/vault/project/src/main.ts"),
      fileChangeItem("f2", "t1", "/vault/project/styles.css"),
      fileChangeItem("f3", "t1", "/tmp/outside.txt"),
      { id: "a1", kind: "message", role: "assistant", text: "done", turnId: "t1" },
    ];

    const assistantBlock = displayBlocksForItems(items, null, "/vault/project").find(
      (block) => block.type === "item" && block.item.role === "assistant",
    );
    expect(assistantBlock).toMatchObject({ item: { editedFiles: ["/tmp/outside.txt", "src/main.ts", "styles.css"] } });
  });

  it("detects failed command state", () => {
    expect(
      executionState({
        id: "c1",
        kind: "command",
        role: "tool",
        text: "Command",
        command: "npm test",
        cwd: "/vault",
        status: "failed",
        exitCode: 1,
      }),
    ).toBe("failed");
  });

  it("does not infer command failure from the command text", () => {
    expect(
      executionState({
        id: "c1",
        kind: "command",
        role: "tool",
        text: "rg error src",
        command: "rg error src",
        cwd: "/vault",
        status: "completed",
        exitCode: 0,
      }),
    ).toBe("completed");
  });

  it("uses structured command status before command text", () => {
    expect(
      executionState({
        id: "c1",
        kind: "command",
        role: "tool",
        text: "rg error src",
        command: "rg error src",
        cwd: "/vault",
        status: "running",
      }),
    ).toBe("running");
  });

  it("does not overwrite streamed output with an empty completed item", () => {
    const streamed: DisplayItem = {
      id: "c1",
      itemId: "c1",
      kind: "command",
      role: "tool",
      text: "Command running",
      command: "npm test",
      cwd: "/vault",
      status: "running",
      output: "partial output",
    };
    const completed: DisplayItem = {
      id: "c1",
      itemId: "c1",
      kind: "command",
      role: "tool",
      text: "npm test",
      command: "npm test",
      cwd: "/vault",
      status: "completed",
      output: "",
    };

    expect(upsertDisplayItem([streamed], completed)[0]).toMatchObject({ output: "partial output", status: "completed" });
  });
});
