import { describe, expect, it } from "vitest";

import { collabAgentStateExecutionState } from "../../../../src/features/chat/display/items/agent";
import { activeAgentRunSummary } from "../../../../src/features/chat/display/stream/agent-summary";
import { displayBlocksForItems } from "../../../../src/features/chat/display/stream/blocks";
import {
  appendAssistantDelta,
  appendItemOutput,
  appendItemText,
  appendPlanDelta,
  appendToolOutput,
  upsertDisplayItem,
} from "../../../../src/features/chat/state/message-stream-updates";
import {
  taskProgressDisplayItem,
  taskProgressExecutionState,
} from "../../../../src/features/chat/display/items/task-progress";
import { normalizeProposedPlanMarkdown } from "../../../../src/features/chat/display/items/proposed-plan";
import { pathRelativeToRoot } from "../../../../src/features/chat/display/details/path-labels";
import { permissionRows } from "../../../../src/features/chat/display/details/permission-rows";
import { autoReviewExecutionState, createAutoReviewResultItem, createReviewResultItem } from "../../../../src/features/chat/display/items/review-result";
import {
  commandExecutionState,
  dynamicToolCallExecutionState,
  mcpToolCallExecutionState,
  patchApplyExecutionState,
} from "../../../../src/features/chat/display/turn-items";
import { displayItemFromThreadItem, displayItemsFromTurns } from "../../../../src/features/chat/display/turn-items";
import { referencedThreadPrompt } from "../../../../src/domain/threads/reference";
import type { DisplayItem } from "../../../../src/features/chat/display/types";
import type { Thread } from "../../../../src/domain/threads/model";
import type { AppServerThreadItem, AppServerTurn } from "../../../../src/app-server/turn-model";

function expectPresent<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected value to be present");
  return value;
}

function commandItem(id: string, text: string, turnId: string): DisplayItem {
  return {
    id,
    kind: "command",
    role: "tool",
    text,
    turnId,
    command: text,
    cwd: "/vault",
    status: "completed",
    executionState: "completed",
  };
}

function fileChangeItem(id: string, turnId: string, path = "src/main.ts"): DisplayItem {
  return {
    id,
    kind: "fileChange",
    role: "tool",
    text: "File change completed",
    turnId,
    status: "completed",
    executionState: "completed",
    changes: [{ kind: "update", path, diff: "" }],
  };
}

describe("thread item conversion preserves app-server semantics", () => {
  it("sorts app-server turns oldest first before converting messages", () => {
    const userMessage: AppServerThreadItem = {
      type: "userMessage",
      id: "u1",
      clientId: null,
      content: [{ type: "text", text: "hello", text_elements: [] }],
    };
    const assistantMessage: AppServerThreadItem = { type: "agentMessage", id: "a1", text: "world", phase: null, memoryCitation: null };
    const turns: AppServerTurn[] = [
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
    expect(displayItemFromThreadItem(userMessage)).toMatchObject({ role: "user", copyText: "hello" });
    expect(displayItemFromThreadItem(assistantMessage)).toMatchObject({ role: "assistant", copyText: "world" });
  });

  it("keeps resolved file mentions visible as user message metadata", () => {
    const userMessage: AppServerThreadItem = {
      type: "userMessage",
      id: "u1",
      clientId: null,
      content: [
        { type: "text", text: "Read [[Alpha]] and [[Beta]].", text_elements: [] },
        { type: "mention", name: "Alpha", path: "thoughts/Alpha.md" },
        { type: "mention", name: "Alpha duplicate", path: "thoughts/Alpha.md" },
        { type: "mention", name: "Beta", path: "thoughts/Beta.md" },
      ],
    };

    expect(displayItemFromThreadItem(userMessage)).toMatchObject({
      kind: "message",
      messageKind: "user",
      role: "user",
      text: "Read [[Alpha]] and [[Beta]].",
      mentionedFiles: [
        { name: "Alpha", path: "thoughts/Alpha.md" },
        { name: "Beta", path: "thoughts/Beta.md" },
      ],
    });
  });

  it("hides persisted /refer context in displayed user messages", () => {
    const text = referencedThreadPrompt(
      { id: "thread-reference", name: "参照元", preview: "", archived: false, createdAt: 1, updatedAt: 1 } satisfies Thread,
      [
        { userText: "元の依頼", assistantText: "元の回答" },
        { userText: "次の依頼", assistantText: "次の回答" },
      ],
      "この続きです",
    );

    expect(
      displayItemFromThreadItem({
        type: "userMessage",
        id: "u1",
        clientId: null,
        content: [{ type: "text", text, text_elements: [] }],
      }),
    ).toMatchObject({
      role: "user",
      text: "この続きです",
      copyText: "この続きです",
      referencedThread: {
        threadId: "thread-reference",
        title: "参照元",
        includedTurns: 2,
        turnLimit: 20,
      },
    });
  });

  it("renders resolved skill references as inline code without changing copy text", () => {
    const item: AppServerThreadItem = {
      type: "userMessage",
      id: "u1",
      clientId: null,
      content: [
        { type: "text", text: "Use $obsidian-codex-panel-maintain and $missing.", text_elements: [] },
        { type: "skill", name: "obsidian-codex-panel-maintain", path: "/skills/obsidian-codex-panel-maintain/SKILL.md" },
      ],
    };

    expect(displayItemFromThreadItem(item)).toMatchObject({
      text: "Use `$obsidian-codex-panel-maintain` and $missing.",
      copyText: "Use $obsidian-codex-panel-maintain and $missing.",
    });
  });

  it("does not rewrite skill references that are already in markdown code", () => {
    const item: AppServerThreadItem = {
      type: "userMessage",
      id: "u1",
      clientId: null,
      content: [
        {
          type: "text",
          text: "Use `$obsidian-codex-panel-maintain`.\n\n```\n$obsidian-codex-panel-maintain\n```\n\nThen $obsidian-codex-panel-maintain.",
          text_elements: [],
        },
        { type: "skill", name: "obsidian-codex-panel-maintain", path: "/skills/obsidian-codex-panel-maintain/SKILL.md" },
      ],
    };

    expect(displayItemFromThreadItem(item)).toMatchObject({
      text: "Use `$obsidian-codex-panel-maintain`.\n\n```\n$obsidian-codex-panel-maintain\n```\n\nThen `$obsidian-codex-panel-maintain`.",
    });
  });

  it("preserves reasoning text", () => {
    const item: AppServerThreadItem = { type: "reasoning", id: "r1", summary: ["summary"], content: ["detail"] };
    expect(displayItemFromThreadItem(item)?.text).toBe("summary\n\ndetail");
  });

  it("keeps empty reasoning text empty so completed placeholders can be hidden", () => {
    const item: AppServerThreadItem = { type: "reasoning", id: "r1", summary: [], content: [] };
    expect(displayItemFromThreadItem(item)?.text).toBe("");
  });

  it("renders completed proposed plans as copyable assistant markdown", () => {
    const item: AppServerThreadItem = { type: "plan", id: "p1", text: "<proposed_plan>\n# Plan\n</proposed_plan>" };
    expect(displayItemFromThreadItem(item, "t1")).toMatchObject({
      id: "p1",
      kind: "message",
      role: "assistant",
      text: "# Plan",
      copyText: "# Plan",
      messageKind: "proposedPlan",
      messageState: "completed",
      turnId: "t1",
    });
  });

  it("normalizes proposed plan wrappers before markdown rendering", () => {
    expect(normalizeProposedPlanMarkdown("<proposed_plan>\n## Summary\n- Ship it\n</proposed_plan>")).toBe("## Summary\n- Ship it");
  });

  it("streams assistant deltas as markdown", () => {
    const items = appendAssistantDelta([], "a1", "t1", "**Hello**");
    const updated = appendAssistantDelta(items, "a1", "t1", "\n\n- world");
    expect(updated).toMatchObject([
      {
        id: "a1",
        kind: "message",
        role: "assistant",
        text: "**Hello**\n\n- world",
        copyText: "**Hello**\n\n- world",
        messageKind: "assistantResponse",
        messageState: "streaming",
      },
    ]);
  });

  it("streams plan deltas as plain assistant text until completion", () => {
    const items = appendPlanDelta([], "p1", "t1", "<proposed_plan>\n# Plan");
    const updated = appendPlanDelta(items, "p1", "t1", "\n</proposed_plan>");
    expect(updated).toMatchObject([
      {
        id: "p1",
        kind: "message",
        role: "assistant",
        text: "# Plan",
        copyText: "# Plan",
        messageKind: "proposedPlan",
        messageState: "streaming",
      },
    ]);
  });

  it("formats structured plan progress as task progress", () => {
    expect(
      taskProgressDisplayItem("t1", "Working plan", [
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
    const item: AppServerThreadItem = {
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
      executionState: "completed",
    });
  });

  it("marks completed spawn calls complete even before child state arrives", () => {
    const item: AppServerThreadItem = {
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
      executionState: "completed",
    });
  });

  it("keeps command output in details instead of inline summaries", () => {
    const item: AppServerThreadItem = {
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
      executionState: "failed",
    });
  });

  it("labels parsed read commands separately from generic commands", () => {
    const item: AppServerThreadItem = {
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
      executionState: "completed",
    });
  });

  it("summarizes piped parsed read commands by file name only", () => {
    const item: AppServerThreadItem = {
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
      executionState: "completed",
    });
  });

  it("keeps absolute read paths when they are outside the command cwd", () => {
    const item: AppServerThreadItem = {
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
      executionState: "completed",
    });
  });

  it("summarizes zsh login wrapper commands without changing their command classification", () => {
    const item: AppServerThreadItem = {
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
      executionState: "completed",
    });
  });

  it("labels parsed search commands and summarizes their query and path", () => {
    const item: AppServerThreadItem = {
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
      executionState: "completed",
    });
  });

  it("summarizes parsed search paths relative to the command cwd", () => {
    const item: AppServerThreadItem = {
      type: "commandExecution",
      id: "cmd-1",
      command: "rg target /vault/src/display",
      cwd: "/vault",
      processId: null,
      source: "agent",
      status: "completed",
      commandActions: [{ type: "search", command: "rg", query: "target", path: "/vault/src/display" }],
      aggregatedOutput: "search results",
      exitCode: 0,
      durationMs: 10,
    };

    expect(displayItemFromThreadItem(item, "t1")).toMatchObject({
      kind: "command",
      actionLabel: "search",
      text: "target in src/display",
      executionState: "completed",
    });
  });

  it("summarizes Windows paths relative to the command cwd", () => {
    const item: AppServerThreadItem = {
      type: "commandExecution",
      id: "cmd-1",
      command: "rg target C:\\Vault\\src\\display",
      cwd: "C:\\Vault",
      processId: null,
      source: "agent",
      status: "completed",
      commandActions: [{ type: "search", command: "rg", query: "target", path: "C:\\Vault\\src\\display" }],
      aggregatedOutput: "search results",
      exitCode: 0,
      durationMs: 10,
    };

    expect(displayItemFromThreadItem(item, "t1")).toMatchObject({
      kind: "command",
      actionLabel: "search",
      text: "target in src/display",
      executionState: "completed",
    });
  });

  it("labels parsed file listing commands and summarizes their path", () => {
    const item: AppServerThreadItem = {
      type: "commandExecution",
      id: "cmd-1",
      command: "rg --files src/display",
      cwd: "/vault",
      processId: null,
      source: "agent",
      status: "completed",
      commandActions: [{ type: "listFiles", command: "rg", path: "src/display" }],
      aggregatedOutput: "src/display/thread-items.ts",
      exitCode: 0,
      durationMs: 10,
    };

    expect(displayItemFromThreadItem(item, "t1")).toMatchObject({
      kind: "command",
      actionLabel: "list files",
      text: "src/display",
      executionState: "completed",
    });
  });

  it("uses the representative command action for both label and summary", () => {
    const item: AppServerThreadItem = {
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
      executionState: "completed",
    });
  });

  it("summarizes parsed workspace file listings without a path", () => {
    const item: AppServerThreadItem = {
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
      executionState: "completed",
    });
  });

  it("uses structured command status instead of stdout or stderr text", () => {
    const item: AppServerThreadItem = {
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
      executionState: "completed",
    });
  });

  it("omits running qualifiers from command, file change, and tool summaries", () => {
    const command: AppServerThreadItem = {
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
    const fileChange: AppServerThreadItem = {
      type: "fileChange",
      id: "patch-1",
      status: "inProgress",
      changes: [{ kind: { type: "update", move_path: null }, path: "src/main.ts", diff: "@@\n-old\n+new" }],
    };
    const tool: AppServerThreadItem = {
      type: "mcpToolCall",
      id: "mcp-1",
      server: "github",
      tool: "pull_request_read",
      status: "inProgress",
      arguments: { id: 123 },
      pluginId: null,
      result: null,
      error: null,
      durationMs: null,
    };

    expect(displayItemFromThreadItem(command, "t1")).toMatchObject({
      text: "npm run check",
      executionState: "running",
    });
    expect(displayItemFromThreadItem(fileChange, "t1")).toMatchObject({
      text: "src/main.ts",
      executionState: "running",
    });
    expect(displayItemFromThreadItem(tool, "t1")).toMatchObject({
      text: "123",
      toolLabel: "github.pull_request_read",
      executionState: "running",
    });
  });

  it("summarizes MCP tool calls from structured arguments and errors", () => {
    const item: AppServerThreadItem = {
      type: "mcpToolCall",
      id: "mcp-1",
      server: "github",
      tool: "pull_request_read",
      status: "failed",
      arguments: { owner: "org", repo: "project", id: 123 },
      pluginId: null,
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
      executionState: "failed",
    });
  });

  it("summarizes dynamic tool calls from structured arguments only", () => {
    const item: AppServerThreadItem = {
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
      executionState: "completed",
    });
  });

  it("marks image view summaries as path summaries", () => {
    const item: AppServerThreadItem = {
      type: "imageView",
      id: "image-1",
      path: "/vault/project/assets/image.png",
    };

    expect(displayItemFromThreadItem(item, "t1")).toMatchObject({
      kind: "tool",
      text: "/vault/project/assets/image.png",
      toolLabel: "imageView",
      summaryPath: true,
    });
  });

  it("preserves image generation status, details, and state", () => {
    const item: AppServerThreadItem = {
      type: "imageGeneration",
      id: "image-gen-1",
      status: "completed",
      revisedPrompt: "A precise UI mockup.",
      result: "image result",
      savedPath: "/vault/project/assets/generated.png",
    };

    expect(displayItemFromThreadItem(item, "t1")).toMatchObject({
      kind: "tool",
      text: "/vault/project/assets/generated.png",
      toolLabel: "imageGeneration",
      summaryPath: true,
      status: "completed",
      details: [
        { title: "Saved path", body: "/vault/project/assets/generated.png" },
        { title: "Revised prompt", body: "A precise UI mockup." },
        { title: "Result", body: "image result" },
      ],
      executionState: "completed",
    });
  });

  it("uses image generation result as the summary when no saved path is present", () => {
    const item: AppServerThreadItem = {
      type: "imageGeneration",
      id: "image-gen-1",
      status: "completed",
      revisedPrompt: "A precise UI mockup.",
      result: "image result",
    };

    expect(displayItemFromThreadItem(item, "t1")).toMatchObject({
      kind: "tool",
      text: "image result",
      toolLabel: "imageGeneration",
      summaryPath: false,
      details: [
        { title: "Revised prompt", body: "A precise UI mockup." },
        { title: "Result", body: "image result" },
      ],
    });
  });

  it("uses details as the summary when a tool target cannot be extracted", () => {
    const item: AppServerThreadItem = {
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
      executionState: "completed",
    });
  });

  it("summarizes web search actions by action type and target", () => {
    const item: AppServerThreadItem = {
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

  it("preserves review mode items with their review output", () => {
    const entered: AppServerThreadItem = { type: "enteredReviewMode", id: "review-entered", review: "Review started" };
    const exited: AppServerThreadItem = { type: "exitedReviewMode", id: "review-exited", review: "Review finished" };

    expect(displayItemFromThreadItem(entered, "t1")).toMatchObject({
      kind: "tool",
      text: "Entered review mode",
      toolLabel: "enteredReviewMode",
      output: "Review started",
    });
    expect(displayItemFromThreadItem(exited, "t1")).toMatchObject({
      kind: "tool",
      text: "Exited review mode",
      toolLabel: "exitedReviewMode",
      output: "Review finished",
    });
  });

  it("preserves context compaction items as short work items", () => {
    const item: AppServerThreadItem = { type: "contextCompaction", id: "compact-1" };

    expect(displayItemFromThreadItem(item, "t1")).toMatchObject({
      kind: "contextCompaction",
      text: "Context compaction",
      turnId: "t1",
      sourceItemId: "compact-1",
    });
  });

  it("structures automatic approval review summary messages", () => {
    expect(
      createReviewResultItem(
        "review-1",
        "Automatic approval review approved (risk: low, authorization: unknown): Auto-review returned a low-risk allow decision.",
      ),
    ).toMatchObject({
      kind: "reviewResult",
      text: "Auto-review approved: Auto-review returned a low-risk allow decision.",
      executionState: "completed",
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
        action: { type: "applyPatch", cwd: "/vault", files: ["/vault/src/display/thread-items.ts", "/vault/tests/display-model.test.ts"] },
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
            { key: "files", value: "src/display/thread-items.ts\ntests/display-model.test.ts" },
          ]),
        },
      ],
    });
  });
});

describe("permission detail rows", () => {
  it("formats app-server permission paths without exposing raw payloads", () => {
    expect(
      permissionRows({
        network: { enabled: true },
        fileSystem: {
          entries: [
            { path: { type: "path", path: "/vault/notes.md" }, access: "read" },
            { path: { type: "glob_pattern", pattern: "/vault/**/*.md" }, access: "write" },
            { path: { type: "special", value: { kind: "project_roots", subpath: "src" } }, access: "read" },
            { path: { type: "special", value: { kind: "unknown", path: "custom", subpath: "cache" } }, access: "write" },
          ],
          read: [],
          write: null,
          globScanMaxDepth: 4,
        },
      }),
    ).toEqual([
      { key: "network", value: "enabled" },
      {
        key: "filesystem",
        value: "/vault/notes.md (read)\n/vault/**/*.md (write)\nproject_roots/src (read)\ncustom/cache (write)",
      },
      { key: "glob depth", value: "4" },
    ]);
  });
});

describe("streaming updates target item identity without mutating history", () => {
  it("upserts assistant deltas by item id, not by last position", () => {
    const items: DisplayItem[] = [
      {
        id: "a1",
        sourceItemId: "a1",
        kind: "message",
        role: "assistant",
        text: "hello",
        messageKind: "assistantResponse",
        messageState: "completed",
      },
      { id: "tool1", sourceItemId: "tool1", kind: "tool", role: "tool", text: "tool" },
    ];

    const updated = appendAssistantDelta(items, "a1", "t1", " world");
    expect(expectPresent(updated[0]).text).toBe("hello world");
    expect(expectPresent(updated[0])).toMatchObject({ copyText: "hello world" });
    expect(updated).toHaveLength(2);
    expect(expectPresent(items[0]).text).toBe("hello");
    expect(updated).not.toBe(items);
  });

  it("appends tool text and output without mutating existing display items", () => {
    const tool: DisplayItem = { id: "tool1", sourceItemId: "tool1", kind: "tool", role: "tool", text: "plan: " };
    const command: DisplayItem = {
      id: "cmd1",
      sourceItemId: "cmd1",
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
});

describe("display block grouping keeps work logs subordinate to conversation messages", () => {
  it("groups completed turn activities before the final assistant message", () => {
    const items: DisplayItem[] = [
      { id: "u1", kind: "message", messageKind: "user", role: "user", text: "do it", turnId: "t1" },
      { id: "r1", kind: "reasoning", role: "tool", text: "thinking", turnId: "t1" },
      commandItem("c1", "npm test", "t1"),
      {
        id: "a1",
        kind: "message",
        role: "assistant",
        text: "done",
        turnId: "t1",
        messageKind: "assistantResponse",
        messageState: "completed",
      },
    ];

    const blocks = displayBlocksForItems(items, null);
    expect(blocks.map((block) => block.type)).toEqual(["item", "activityGroup", "item"]);
    expect(blocks[1]).toMatchObject({ summary: "Work details: command, thought" });
  });

  it("groups completed hook and review logs before the final assistant message", () => {
    const items: DisplayItem[] = [
      { id: "u1", kind: "message", messageKind: "user", role: "user", text: "do it", turnId: "t1" },
      {
        id: "hook-1",
        kind: "hook",
        role: "tool",
        text: "userPromptSubmit: Saving jj baseline",
        toolLabel: "hook",
        turnId: "t1",
        status: "completed",
      },
      commandItem("c1", "npm test", "t1"),
      { id: "r1", kind: "reasoning", role: "tool", text: "thinking", turnId: "t1", status: "completed" },
      {
        id: "review-1",
        kind: "reviewResult",
        role: "tool",
        text: "Auto-review approved: npm test",
        turnId: "t1",
        executionState: "completed",
      },
      {
        id: "review-2",
        kind: "reviewResult",
        role: "tool",
        text: "Auto-review approved: npm test",
        turnId: "t1",
        executionState: "completed",
      },
      {
        id: "a1",
        kind: "message",
        role: "assistant",
        text: "done",
        turnId: "t1",
        messageKind: "assistantResponse",
        messageState: "completed",
      },
    ];

    const blocks = displayBlocksForItems(items, null);

    expect(blocks.map((block) => (block.type === "item" ? block.item.id : block.id))).toEqual(["u1", "turn-t1-activity", "a1"]);
    expect(blocks[1]).toMatchObject({
      summary: "Work details: command, hook, thought, 2 reviews",
      items: [{ id: "hook-1" }, { id: "c1" }, { id: "r1" }, { id: "review-1" }, { id: "review-2" }],
    });
    expect(blocks[2]).toMatchObject({
      item: { id: "a1", autoReviewSummaries: ["Auto-review approved: npm test", "Auto-review approved: npm test"] },
    });
  });

  it("hides empty completed reasoning items", () => {
    const items: DisplayItem[] = [
      { id: "u1", kind: "message", messageKind: "user", role: "user", text: "do it", turnId: "t1" },
      { id: "r1", kind: "reasoning", role: "tool", text: "", turnId: "t1", status: "completed", executionState: "completed" },
      {
        id: "a1",
        kind: "message",
        role: "assistant",
        text: "done",
        turnId: "t1",
        messageKind: "assistantResponse",
        messageState: "completed",
      },
    ];

    const blocks = displayBlocksForItems(items, null);
    expect(blocks.map((block) => (block.type === "item" ? block.item.id : block.id))).toEqual(["u1", "a1"]);
  });

  it("collapses earlier assistant responses with their turn details", () => {
    const items: DisplayItem[] = [
      { id: "u1", kind: "message", messageKind: "user", role: "user", text: "do it", turnId: "t1" },
      {
        id: "a1",
        kind: "message",
        role: "assistant",
        text: "I'll inspect it.",
        turnId: "t1",
        messageKind: "assistantResponse",
        messageState: "completed",
      },
      commandItem("c1", "rg issue", "t1"),
      {
        id: "a2",
        kind: "message",
        role: "assistant",
        text: "I found the cause.",
        turnId: "t1",
        messageKind: "assistantResponse",
        messageState: "completed",
      },
      fileChangeItem("f1", "t1"),
      {
        id: "a3",
        kind: "message",
        role: "assistant",
        text: "done",
        turnId: "t1",
        messageKind: "assistantResponse",
        messageState: "completed",
      },
    ];

    const blocks = displayBlocksForItems(items, null);
    expect(blocks.map((block) => block.type)).toEqual(["item", "activityGroup", "item"]);
    expect(blocks[1]).toMatchObject({
      summary: "Work details: 2 responses, command, file change",
      items: [{ id: "a1" }, { id: "c1" }, { id: "a2" }, { id: "f1" }],
    });
    expect(blocks[2]).toMatchObject({ item: { id: "a3" } });
  });

  it("keeps completed turn work details attached to the final response even when system messages are interleaved", () => {
    const items: DisplayItem[] = [
      { id: "s1", kind: "system", role: "system", text: "debug before hook" },
      commandItem("c1", "npm test", "t1"),
      { id: "s2", kind: "system", role: "system", text: "debug after hook" },
      {
        id: "a1",
        kind: "message",
        role: "assistant",
        text: "done",
        turnId: "t1",
        messageKind: "assistantResponse",
        messageState: "completed",
      },
    ];

    const blocks = displayBlocksForItems(items, null);

    expect(blocks.map((block) => (block.type === "item" ? block.item.id : block.id))).toEqual(["s1", "s2", "turn-t1-activity", "a1"]);
  });

  it("adds steering markers to completed turn work details without hiding the steering message", () => {
    const items: DisplayItem[] = [
      { id: "u1", kind: "message", messageKind: "user", role: "user", text: "do it", turnId: "t1" },
      commandItem("c1", "rg issue", "t1"),
      { id: "u2", kind: "message", messageKind: "user", role: "user", text: "also check tests", turnId: "t1", clientId: "local-steer-1" },
      commandItem("c2", "npm test", "t1"),
      {
        id: "a1",
        kind: "message",
        role: "assistant",
        text: "done",
        turnId: "t1",
        messageKind: "assistantResponse",
        messageState: "completed",
      },
    ];

    const blocks = displayBlocksForItems(items, null);

    expect(blocks.map((block) => (block.type === "item" ? block.item.id : block.id))).toEqual(["u1", "u2", "turn-t1-activity", "a1"]);
    expect(blocks[2]).toMatchObject({
      summary: "Work details: steer, 2 commands",
      items: [
        { id: "c1" },
        { id: "steer-activity-u2", text: "also check tests", activityKind: "userSteered", toolLabel: "steer" },
        { id: "c2" },
      ],
    });
  });

  it("pluralizes multiple steering markers as steers in completed turn work details", () => {
    const items: DisplayItem[] = [
      { id: "u1", kind: "message", messageKind: "user", role: "user", text: "do it", turnId: "t1" },
      { id: "u2", kind: "message", messageKind: "user", role: "user", text: "also check tests", turnId: "t1" },
      { id: "u3", kind: "message", messageKind: "user", role: "user", text: "and update docs", turnId: "t1" },
      {
        id: "a1",
        kind: "message",
        role: "assistant",
        text: "done",
        turnId: "t1",
        messageKind: "assistantResponse",
        messageState: "completed",
      },
    ];

    const blocks = displayBlocksForItems(items, null);
    const activityGroup = blocks.find((block) => block.type === "activityGroup");

    expect(activityGroup).toMatchObject({
      summary: "Work details: 2 steers",
      items: [{ id: "steer-activity-u2" }, { id: "steer-activity-u3" }],
    });
  });

  it("keeps active turn activities expanded", () => {
    const items: DisplayItem[] = [
      { id: "r1", kind: "reasoning", role: "tool", text: "thinking", turnId: "t1" },
      {
        id: "a1",
        kind: "message",
        role: "assistant",
        text: "done",
        turnId: "t1",
        messageKind: "assistantResponse",
        messageState: "completed",
      },
    ];

    expect(displayBlocksForItems(items, "t1").map((block) => block.type)).toEqual(["item", "item"]);
  });

  it("keeps active task progress chronological in the display model", () => {
    const items: DisplayItem[] = [
      { id: "u1", kind: "message", messageKind: "user", role: "user", text: "do it", turnId: "t1" },
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
        kind: "message",
        role: "assistant",
        text: "working",
        turnId: "t1",
        messageKind: "assistantResponse",
        messageState: "completed",
      },
    ];

    const blocks = displayBlocksForItems(items, "t1");

    expect(blocks.map((block) => (block.type === "item" ? block.item.id : block.id))).toEqual(["u1", "plan-progress-t1", "a1"]);
  });

  it("summarizes task progress and agent activity separately from tools", () => {
    const items: DisplayItem[] = [
      { id: "u1", kind: "message", messageKind: "user", role: "user", text: "do it", turnId: "t1" },
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
      {
        id: "a1",
        kind: "message",
        role: "assistant",
        text: "done",
        turnId: "t1",
        messageKind: "assistantResponse",
        messageState: "completed",
      },
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

    expect(activeAgentRunSummary(items, "t1")).toEqual({
      running: 1,
      completed: 1,
      failed: 1,
      agents: [{ threadId: "running", status: "running", messagePreview: null }],
      additionalAgents: 0,
    });
    expect(activeAgentRunSummary(items, null)).toBeNull();
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
        receiverThreadIds: ["a", "b", "c", "d", "e"],
        prompt: null,
        model: null,
        reasoningEffort: null,
        agents: [
          { threadId: "a", status: "running", message: "\n  Inspecting   renderer   tests  \nmore details" },
          { threadId: "b", status: "failed", message: "Could not reproduce" },
          { threadId: "c", status: "running", message: null },
          { threadId: "d", status: "running", message: "Reviewing details" },
          { threadId: "e", status: "running", message: "Checking scroll behavior" },
        ],
      },
    ];

    expect(activeAgentRunSummary(items, "t1")).toMatchObject({
      running: 5,
      completed: 0,
      failed: 1,
      agents: [
        { threadId: "a", status: "running", messagePreview: "Inspecting renderer tests" },
        { threadId: "c", status: "running", messagePreview: null },
        { threadId: "d", status: "running", messagePreview: "Reviewing details" },
        { threadId: "e", status: "running", messagePreview: "Checking scroll behavior" },
        { threadId: "fallback-child", status: "inProgress", messagePreview: null },
      ],
      additionalAgents: 0,
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

    expect(activeAgentRunSummary(items, "t1")).toBeNull();
  });

  it("adds edited files to the final assistant message", () => {
    const items: DisplayItem[] = [
      fileChangeItem("f1", "t1", "src/main.ts"),
      fileChangeItem("f2", "t1", "styles.css"),
      {
        id: "a1",
        kind: "message",
        role: "assistant",
        text: "intermediate",
        turnId: "t1",
        messageKind: "assistantResponse",
        messageState: "completed",
      },
      {
        id: "a2",
        kind: "message",
        role: "assistant",
        text: "done",
        turnId: "t1",
        messageKind: "assistantResponse",
        messageState: "completed",
      },
    ];

    const assistantBlock = displayBlocksForItems(items, null).find((block) => block.type === "item" && block.item.role === "assistant");
    expect(assistantBlock).toMatchObject({ item: { editedFiles: ["src/main.ts", "styles.css"] } });
  });

  it("adds turn diff metadata to the final assistant message only when aggregated diff exists", () => {
    const items: DisplayItem[] = [
      fileChangeItem("f1", "t1", "src/main.ts"),
      {
        id: "a1",
        kind: "message",
        role: "assistant",
        text: "done",
        turnId: "t1",
        messageKind: "assistantResponse",
        messageState: "completed",
      },
    ];

    const withoutDiff = displayBlocksForItems(items, null).find((block) => block.type === "item" && block.item.role === "assistant");
    expect(withoutDiff).toMatchObject({ item: { editedFiles: ["src/main.ts"] } });
    expect(withoutDiff?.type === "item" ? withoutDiff.item : null).not.toHaveProperty("turnDiff");

    const withDiff = displayBlocksForItems(items, null, null, new Map([["t1", "@@\n-old\n+new"]])).find(
      (block) => block.type === "item" && block.item.role === "assistant",
    );
    expect(withDiff).toMatchObject({ item: { editedFiles: ["src/main.ts"], turnDiff: { diff: "@@\n-old\n+new" } } });
  });

  it("adds auto-review summaries to the final assistant message", () => {
    const items: DisplayItem[] = [
      {
        id: "review-1",
        kind: "reviewResult",
        role: "tool",
        text: "Auto-review approved: npm test",
        turnId: "t1",
        executionState: "completed",
      },
      {
        id: "review-2",
        kind: "reviewResult",
        role: "tool",
        text: "Auto-review approved: npm test",
        turnId: "t1",
        executionState: "completed",
      },
      {
        id: "a1",
        kind: "message",
        role: "assistant",
        text: "done",
        turnId: "t1",
        messageKind: "assistantResponse",
        messageState: "completed",
      },
    ];

    const assistantBlock = displayBlocksForItems(items, null).find((block) => block.type === "item" && block.item.role === "assistant");
    expect(assistantBlock).toMatchObject({
      item: { autoReviewSummaries: ["Auto-review approved: npm test", "Auto-review approved: npm test"] },
    });
  });

  it("does not add edited file or auto-review summaries to active turn messages", () => {
    const items: DisplayItem[] = [
      fileChangeItem("f1", "t1", "src/main.ts"),
      {
        id: "review-1",
        kind: "reviewResult",
        role: "tool",
        text: "Auto-review approved: npm test",
        turnId: "t1",
        executionState: "completed",
      },
      {
        id: "a1",
        kind: "message",
        role: "assistant",
        text: "still working",
        turnId: "t1",
        messageKind: "assistantResponse",
        messageState: "completed",
      },
    ];

    const assistantBlock = displayBlocksForItems(items, "t1").find((block) => block.type === "item" && block.item.id === "a1");
    expect(assistantBlock?.type === "item" ? assistantBlock.item : null).not.toHaveProperty("editedFiles");
    expect(assistantBlock?.type === "item" ? assistantBlock.item : null).not.toHaveProperty("autoReviewSummaries");
  });
});

describe("workspace path summaries stay readable without hiding audit paths", () => {
  it("shows edited files relative to the workspace root", () => {
    const items: DisplayItem[] = [
      fileChangeItem("f1", "t1", "/vault/project/src/main.ts"),
      fileChangeItem("f2", "t1", "/vault/project/styles.css"),
      fileChangeItem("f3", "t1", "/tmp/outside.txt"),
      {
        id: "a1",
        kind: "message",
        role: "assistant",
        text: "done",
        turnId: "t1",
        messageKind: "assistantResponse",
        messageState: "completed",
      },
    ];

    const assistantBlock = displayBlocksForItems(items, null, "/vault/project").find(
      (block) => block.type === "item" && block.item.role === "assistant",
    );
    expect(assistantBlock).toMatchObject({ item: { editedFiles: ["/tmp/outside.txt", "src/main.ts", "styles.css"] } });
  });

  it("keeps Windows sibling paths outside the workspace root", () => {
    expect(pathRelativeToRoot("C:\\Vault\\project\\src\\main.ts", "C:\\Vault\\project")).toBe("src/main.ts");
    expect(pathRelativeToRoot("C:\\Vault\\project-other\\src\\main.ts", "C:\\Vault\\project")).toBe("C:/Vault/project-other/src/main.ts");
  });
});

describe("execution state uses typed status adapters before rendered text", () => {
  it("detects failed command state", () => {
    expect(commandExecutionState("failed", 1)).toBe("failed");
  });

  it("does not infer command failure from the command text", () => {
    expect(commandExecutionState("completed", 0)).toBe("completed");
  });

  it("uses typed command status before command text", () => {
    expect(commandExecutionState("inProgress")).toBe("running");
  });

  it("keeps command exit code precedence as a Panel display rule", () => {
    expect(commandExecutionState("completed", 1)).toBe("failed");
    expect(commandExecutionState("unknown", 0)).toBe("completed");
  });

  it("maps app-server status strings into Panel execution states", () => {
    expect(patchApplyExecutionState("declined")).toBe("failed");
    expect(mcpToolCallExecutionState("completed")).toBe("completed");
    expect(taskProgressExecutionState("pending")).toBe("running");
    expect(autoReviewExecutionState("approved")).toBe("completed");
    expect(autoReviewExecutionState("timedOut")).toBe("failed");
    expect(collabAgentStateExecutionState("inProgress")).toBe("running");
    expect(collabAgentStateExecutionState("failed")).toBe("failed");
  });

  it("uses dynamic tool success as a display fallback", () => {
    expect(dynamicToolCallExecutionState("unknown", true)).toBe("completed");
    expect(dynamicToolCallExecutionState("completed", false)).toBe("failed");
  });

  it("does not infer unknown status strings with broad matching", () => {
    expect(patchApplyExecutionState("done_with_errors")).toBeNull();
    const item: DisplayItem = {
      id: "c1",
      kind: "command",
      role: "tool",
      text: "Command",
      command: "npm test",
      cwd: "/vault",
      status: "done_with_errors",
    };
    expect(item.executionState ?? null).toBeNull();
  });

  it("does not overwrite streamed output with an empty completed item", () => {
    const streamed: DisplayItem = {
      id: "c1",
      sourceItemId: "c1",
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
      sourceItemId: "c1",
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
