import { describe, expect, it } from "vitest";

import { collabAgentStateExecutionState } from "../../../../src/features/chat/domain/message-stream/agent-state";
import { activeTurnLiveItems } from "../../../../src/features/chat/domain/message-stream/semantics/active-turn";
import { messageStreamLayoutBlocks } from "../../../../src/features/chat/presentation/message-stream/layout";
import { upsertMessageStreamItemById } from "../../../../src/features/chat/domain/message-stream/updates";
import { taskProgressMessageStreamItem } from "../../../../src/features/chat/app-server/mappers/message-stream/task-progress";
import { pathRelativeToRoot } from "../../../../src/shared/path/file-paths";
import { permissionRows } from "../../../../src/features/chat/domain/message-stream/format/permission-rows";
import {
  createAutoReviewResultItem,
  createReviewResultItem,
} from "../../../../src/features/chat/app-server/mappers/message-stream/review-result-items";
import { hookRunMessageStreamItem } from "../../../../src/features/chat/app-server/mappers/message-stream/hook-run-items";
import {
  messageStreamItemFromTurnItem,
  messageStreamItemsFromTurns,
} from "../../../../src/features/chat/app-server/mappers/message-stream/turn-items";
import { referencedThreadPromptBundle } from "../../../../src/domain/threads/reference";
import type { MessageStreamItem } from "../../../../src/features/chat/domain/message-stream/items";
import type { Thread } from "../../../../src/domain/threads/model";
import type { TurnItem, TurnRecord } from "../../../../src/app-server/protocol/turn";

function commandItem(id: string, text: string, turnId: string): MessageStreamItem {
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

function fileChangeItem(id: string, turnId: string, path = "src/main.ts"): MessageStreamItem {
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

function autoReviewResultItem(id: string, turnId: string, text = "Auto-review approved: npm test"): MessageStreamItem {
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

function activeAgentSummary(items: readonly MessageStreamItem[], activeTurnId: string | null) {
  if (!activeTurnId) return null;
  return activeTurnLiveItems({ items }, activeTurnId).find((item) => item.kind === "agentSummary")?.summary ?? null;
}

describe("turn item conversion preserves app-server semantics", () => {
  it("sorts app-server turns oldest first before converting messages", () => {
    const userMessage: TurnItem = {
      type: "userMessage",
      id: "u1",
      clientId: null,
      content: [{ type: "text", text: "hello", text_elements: [] }],
    };
    const assistantMessage: TurnItem = { type: "agentMessage", id: "a1", text: "world", phase: null, memoryCitation: null };
    const turns: TurnRecord[] = [
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

    expect(
      messageStreamItemsFromTurns(turns)
        .filter((item) => item.kind === "message")
        .map((item) => item.text),
    ).toEqual(["hello", "world"]);
    expect(messageStreamItemFromTurnItem(userMessage)).toMatchObject({ role: "user", copyText: "hello" });
    expect(messageStreamItemFromTurnItem(assistantMessage)).toMatchObject({ role: "assistant", copyText: "world" });
  });

  it("keeps resolved file mentions visible as user message metadata", () => {
    const userMessage: TurnItem = {
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

    expect(messageStreamItemFromTurnItem(userMessage)).toMatchObject({
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
    const { prompt: text } = referencedThreadPromptBundle(
      { id: "thread-reference", name: "参照元", preview: "", archived: false, createdAt: 1, updatedAt: 1 } satisfies Thread,
      [
        { userText: "元の依頼", assistantText: "元の回答" },
        { userText: "次の依頼", assistantText: "次の回答" },
      ],
      "この続きです",
    );

    expect(
      messageStreamItemFromTurnItem({
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
    const item: TurnItem = {
      type: "userMessage",
      id: "u1",
      clientId: null,
      content: [
        { type: "text", text: "Use $obsidian-codex-panel-maintain and $missing.", text_elements: [] },
        { type: "skill", name: "obsidian-codex-panel-maintain", path: "/skills/obsidian-codex-panel-maintain/SKILL.md" },
      ],
    };

    expect(messageStreamItemFromTurnItem(item)).toMatchObject({
      text: "Use `$obsidian-codex-panel-maintain` and $missing.",
      copyText: "Use $obsidian-codex-panel-maintain and $missing.",
    });
  });

  it("does not rewrite skill references that are already in markdown code", () => {
    const item: TurnItem = {
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

    expect(messageStreamItemFromTurnItem(item)).toMatchObject({
      text: "Use `$obsidian-codex-panel-maintain`.\n\n```\n$obsidian-codex-panel-maintain\n```\n\nThen `$obsidian-codex-panel-maintain`.",
    });
  });

  it("preserves reasoning text", () => {
    const item: TurnItem = { type: "reasoning", id: "r1", summary: ["summary"], content: ["detail"] };
    expect(messageStreamItemFromTurnItem(item)).toMatchObject({ kind: "reasoning", text: "summary\n\ndetail" });
  });

  it("keeps empty reasoning text empty so completed placeholders can be hidden", () => {
    const item: TurnItem = { type: "reasoning", id: "r1", summary: [], content: [] };
    expect(messageStreamItemFromTurnItem(item)).toMatchObject({ kind: "reasoning", text: "" });
  });

  it("renders completed proposed plans as copyable assistant markdown", () => {
    const item: TurnItem = { type: "plan", id: "p1", text: "<proposed_plan>\n# Plan\n</proposed_plan>" };
    expect(messageStreamItemFromTurnItem(item, "t1")).toMatchObject({
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

  it("formats structured plan progress as task progress", () => {
    expect(
      taskProgressMessageStreamItem("t1", "Working plan", [
        { step: "Inspect code", status: "completed" },
        { step: "Patch UI", status: "inProgress" },
        { step: "Run tests", status: "pending" },
      ]),
    ).toMatchObject({
      id: "plan-progress-t1",
      kind: "taskProgress",
      role: "tool",
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
    const item: TurnItem = {
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

    expect(messageStreamItemFromTurnItem(item, "t1")).toMatchObject({
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
    const item: TurnItem = {
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

    expect(messageStreamItemFromTurnItem(item, "t1")).toMatchObject({
      kind: "agent",
      status: "completed",
      executionState: "completed",
    });
  });

  it("keeps command output in details instead of inline summaries", () => {
    expect(
      commandExecutionItem({
        command: "npm run check",
        status: "failed",
        commandActions: [{ type: "unknown", command: "npm" }],
        aggregatedOutput: "stderr with many details",
        exitCode: 1,
        durationMs: 42,
      }),
    ).toMatchObject({
      kind: "command",
      commandTarget: { kind: "command", commandLine: "npm run check" },
      output: "stderr with many details",
      executionState: "failed",
    });
  });

  it("labels parsed read commands separately from generic commands", () => {
    expect(
      commandExecutionItem({
        command: "sed -n '1,20p' src/main.ts",
        commandActions: [{ type: "read", command: "sed", name: "main.ts", path: "/vault/src/main.ts" }],
        aggregatedOutput: "file contents",
        exitCode: 0,
        durationMs: 10,
      }),
    ).toMatchObject({
      kind: "command",
      commandAction: "read",
      commandTarget: { kind: "read", path: "/vault/src/main.ts", name: "main.ts" },
      executionState: "completed",
    });
  });

  it("summarizes piped parsed read commands by file name only", () => {
    expect(
      commandExecutionItem({
        command: "nl -ba src/main.ts | sed -n '1,20p'",
        commandActions: [{ type: "read", command: "nl", name: "main.ts", path: "/vault/src/main.ts" }],
        aggregatedOutput: "numbered file contents",
        exitCode: 0,
        durationMs: 10,
      }),
    ).toMatchObject({
      kind: "command",
      commandAction: "read",
      commandTarget: { kind: "read", path: "/vault/src/main.ts", name: "main.ts" },
      command: "nl -ba src/main.ts | sed -n '1,20p'",
      cwd: "/vault",
      executionState: "completed",
    });
  });

  it("keeps absolute read paths when they are outside the command cwd", () => {
    expect(
      commandExecutionItem({
        command: "sed -n '1,20p' /vault/src/main.ts",
        cwd: "/vault/tests",
        commandActions: [{ type: "read", command: "sed", name: "main.ts", path: "/vault/src/main.ts" }],
        aggregatedOutput: "file contents",
        exitCode: 0,
        durationMs: 10,
      }),
    ).toMatchObject({
      kind: "command",
      commandAction: "read",
      commandTarget: { kind: "read", path: "/vault/src/main.ts", name: "main.ts" },
      executionState: "completed",
    });
  });

  it("summarizes zsh login wrapper commands without changing their command classification", () => {
    expect(
      commandExecutionItem({
        command: "/bin/zsh -lc 'npm run check'",
        commandActions: [{ type: "unknown", command: "zsh" }],
        aggregatedOutput: "check output",
        exitCode: 0,
        durationMs: 10,
      }),
    ).toMatchObject({
      kind: "command",
      commandAction: "command",
      commandTarget: { kind: "command", commandLine: "npm run check" },
      command: "/bin/zsh -lc 'npm run check'",
      cwd: "/vault",
      executionState: "completed",
    });
  });

  it("labels parsed search commands and summarizes their query and path", () => {
    expect(
      commandExecutionItem({
        command: "rg 'command target' src/display",
        commandActions: [{ type: "search", command: "rg", query: "command target", path: "src/display" }],
        aggregatedOutput: "search results",
        exitCode: 0,
        durationMs: 10,
      }),
    ).toMatchObject({
      kind: "command",
      commandAction: "search",
      commandTarget: { kind: "search", query: "command target", path: "src/display" },
      command: "rg 'command target' src/display",
      cwd: "/vault",
      executionState: "completed",
    });
  });

  it("summarizes parsed search paths relative to the command cwd", () => {
    expect(
      commandExecutionItem({
        command: "rg target /vault/src/display",
        commandActions: [{ type: "search", command: "rg", query: "target", path: "/vault/src/display" }],
        aggregatedOutput: "search results",
        exitCode: 0,
        durationMs: 10,
      }),
    ).toMatchObject({
      kind: "command",
      commandAction: "search",
      commandTarget: { kind: "search", query: "target", path: "/vault/src/display" },
      executionState: "completed",
    });
  });

  it("summarizes Windows paths relative to the command cwd", () => {
    expect(
      commandExecutionItem({
        command: "rg target C:\\Vault\\src\\display",
        cwd: "C:\\Vault",
        commandActions: [{ type: "search", command: "rg", query: "target", path: "C:\\Vault\\src\\display" }],
        aggregatedOutput: "search results",
        exitCode: 0,
        durationMs: 10,
      }),
    ).toMatchObject({
      kind: "command",
      commandAction: "search",
      commandTarget: { kind: "search", query: "target", path: "C:\\Vault\\src\\display" },
      executionState: "completed",
    });
  });

  it("labels parsed file listing commands and summarizes their path", () => {
    expect(
      commandExecutionItem({
        command: "rg --files src/display",
        commandActions: [{ type: "listFiles", command: "rg", path: "src/display" }],
        aggregatedOutput: "src/display/thread-items.ts",
        exitCode: 0,
        durationMs: 10,
      }),
    ).toMatchObject({
      kind: "command",
      commandAction: "listFiles",
      commandTarget: { kind: "listFiles", path: "src/display" },
      executionState: "completed",
    });
  });

  it("uses the representative command action for both label and summary", () => {
    expect(
      commandExecutionItem({
        command: "cd src && rg target",
        commandActions: [
          { type: "unknown", command: "cd" },
          { type: "search", command: "rg", query: "target", path: "src" },
        ],
        aggregatedOutput: "search results",
        exitCode: 0,
        durationMs: 10,
      }),
    ).toMatchObject({
      kind: "command",
      commandAction: "search",
      commandTarget: { kind: "search", query: "target", path: "src" },
      executionState: "completed",
    });
  });

  it("summarizes parsed workspace file listings without a path", () => {
    expect(
      commandExecutionItem({
        command: "rg --files",
        commandActions: [{ type: "listFiles", command: "rg", path: null }],
        aggregatedOutput: "README.md",
        exitCode: 0,
        durationMs: 10,
      }),
    ).toMatchObject({
      kind: "command",
      commandAction: "listFiles",
      commandTarget: { kind: "listFiles" },
      executionState: "completed",
    });
  });

  it("uses structured command status instead of stdout or stderr text", () => {
    expect(
      commandExecutionItem({
        command: "rg error src",
        commandActions: [{ type: "unknown", command: "rg" }],
        aggregatedOutput: "error appears as search result text",
        exitCode: 0,
        durationMs: null,
      }),
    ).toMatchObject({
      kind: "command",
      commandTarget: { kind: "command", commandLine: "rg error src" },
      executionState: "completed",
    });
  });

  it("omits running qualifiers from command, file change, and tool summaries", () => {
    expect(
      commandExecutionItem({
        command: "npm run check",
        status: "inProgress",
        commandActions: [{ type: "unknown", command: "npm" }],
      }),
    ).toMatchObject({
      commandTarget: { kind: "command", commandLine: "npm run check" },
      executionState: "running",
    });
    expect(fileChangeStreamItem({ status: "inProgress" })).toMatchObject({
      changes: [{ path: "src/main.ts" }],
      executionState: "running",
    });
    expect(mcpToolCallItem({ status: "inProgress" })).toMatchObject({
      primaryTarget: { kind: "value", value: "123" },
      toolName: "github.pull_request_read",
      executionState: "running",
    });
  });

  it("summarizes MCP tool calls from structured arguments and errors", () => {
    expect(
      mcpToolCallItem({
        status: "failed",
        arguments: { owner: "org", repo: "project", id: 123 },
        error: { message: "Not found" },
        durationMs: 10,
      }),
    ).toMatchObject({
      kind: "tool",
      primaryTarget: { kind: "value", value: "123" },
      failureReason: "Not found",
      toolName: "github.pull_request_read",
      diagnostics: expect.arrayContaining([
        { title: "Arguments JSON", body: expect.stringContaining('"id": 123') },
        { title: "Error JSON", body: expect.stringContaining("Not found") },
      ]),
      executionState: "failed",
    });
  });

  it("summarizes dynamic tool calls from structured arguments only", () => {
    expect(
      dynamicToolCallItem({
        contentItems: [{ type: "inputText", text: "ok" }],
        durationMs: 10,
      }),
    ).toMatchObject({
      kind: "tool",
      primaryTarget: { kind: "value", value: "https://example.com" },
      toolName: "web.open",
      diagnostics: expect.arrayContaining([
        { title: "Arguments JSON", body: expect.stringContaining("https://example.com") },
        { title: "Result JSON", body: expect.stringContaining("inputText") },
      ]),
      executionState: "completed",
    });
  });

  it("marks image view summaries as path summaries", () => {
    const item: TurnItem = {
      type: "imageView",
      id: "image-1",
      path: "/vault/project/assets/image.png",
    };

    expect(messageStreamItemFromTurnItem(item, "t1")).toMatchObject({
      kind: "tool",
      toolName: "imageView",
      primaryTarget: { kind: "path", path: "/vault/project/assets/image.png" },
    });
  });

  it("preserves sleep items as completed wait status summaries", () => {
    const item: TurnItem = {
      type: "sleep",
      id: "sleep-1",
      durationMs: 2500,
    };

    expect(messageStreamItemFromTurnItem(item, "t1")).toMatchObject({
      kind: "wait",
      text: "Waited 2.5s",
      executionState: "completed",
    });
  });

  it("preserves image generation status, details, and state", () => {
    const item: TurnItem = {
      type: "imageGeneration",
      id: "image-gen-1",
      status: "completed",
      revisedPrompt: "A precise UI mockup.",
      result: "image result",
      savedPath: "/vault/project/assets/generated.png",
    };

    expect(messageStreamItemFromTurnItem(item, "t1")).toMatchObject({
      kind: "tool",
      toolName: "imageGeneration",
      primaryTarget: { kind: "path", path: "/vault/project/assets/generated.png" },
      status: "completed",
      imageGeneration: {
        savedPath: "/vault/project/assets/generated.png",
        revisedPrompt: "A precise UI mockup.",
        result: "image result",
      },
      executionState: "completed",
    });
  });

  it("uses image generation result as the summary when no saved path is present", () => {
    const item: TurnItem = {
      type: "imageGeneration",
      id: "image-gen-1",
      status: "completed",
      revisedPrompt: "A precise UI mockup.",
      result: "image result",
    };

    expect(messageStreamItemFromTurnItem(item, "t1")).toMatchObject({
      kind: "tool",
      toolName: "imageGeneration",
      primaryTarget: { kind: "value", value: "image result" },
      imageGeneration: {
        revisedPrompt: "A precise UI mockup.",
        result: "image result",
      },
    });
  });

  it("summarizes web search actions by action type and target", () => {
    const item: TurnItem = {
      type: "webSearch",
      id: "search-1",
      query: "fallback query",
      action: { type: "search", query: "codex app-server", queries: ["obsidian codex panel"] },
    };

    expect(messageStreamItemFromTurnItem(item, "t1")).toMatchObject({
      kind: "tool",
      toolName: "web search",
      operation: "search",
      primaryTarget: { kind: "value", value: "codex app-server; obsidian codex panel; fallback query" },
      webSearch: {
        action: "search",
        query: "codex app-server; obsidian codex panel; fallback query",
      },
    });
  });

  it("omits absent web search details instead of storing undefined fields", () => {
    const item: TurnItem = {
      type: "webSearch",
      id: "search-empty",
      query: "",
      action: null,
    };

    expect(messageStreamItemFromTurnItem(item, "t1")).toEqual({
      id: "search-empty",
      kind: "tool",
      role: "tool",
      toolName: "web search",
      operation: "webSearch",
      turnId: "t1",
      sourceItemId: "search-empty",
      output: "",
      provenance: {
        source: "appServer",
        channel: "turnItem",
        itemType: "webSearch",
        itemId: "search-empty",
      },
    });
  });

  it("preserves review mode items with their review output", () => {
    const entered: TurnItem = { type: "enteredReviewMode", id: "review-entered", review: "Review started" };
    const exited: TurnItem = { type: "exitedReviewMode", id: "review-exited", review: "Review finished" };

    expect(messageStreamItemFromTurnItem(entered, "t1")).toMatchObject({
      kind: "tool",
      toolName: "enteredReviewMode",
      primaryTarget: { kind: "value", value: "Entered review mode" },
      output: "Review started",
    });
    expect(messageStreamItemFromTurnItem(exited, "t1")).toMatchObject({
      kind: "tool",
      toolName: "exitedReviewMode",
      primaryTarget: { kind: "value", value: "Exited review mode" },
      output: "Review finished",
    });
  });

  it("preserves context compaction items as short status items", () => {
    const item: TurnItem = { type: "contextCompaction", id: "compact-1" };

    expect(messageStreamItemFromTurnItem(item, "t1")).toMatchObject({
      kind: "contextCompaction",
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
      review: {
        auditFacts: [
          { key: "status", value: "approved" },
          { key: "risk", value: "low" },
          { key: "authorization", value: "unknown" },
          { key: "message", value: "Auto-review returned a low-risk allow decision." },
        ],
      },
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
      review: {
        auditFacts: expect.arrayContaining([
          { key: "action", value: "apply patch" },
          { key: "cwd", value: "/vault" },
          { key: "files", value: "src/display/thread-items.ts\ntests/display-model.test.ts" },
        ]),
      },
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

describe("display block grouping keeps message stream details subordinate to conversation messages", () => {
  it("groups completed turn activities before the final assistant message", () => {
    const items: MessageStreamItem[] = [
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

    const blocks = messageStreamLayoutBlocks(items, null);
    expect(blocks.map((block) => block.type)).toEqual(["item", "activityGroup", "item"]);
    expect(blocks[1]).toMatchObject({ summary: "Work details" });
  });

  it("groups completed hook and review logs before the final assistant message", () => {
    const items: MessageStreamItem[] = [
      { id: "u1", kind: "message", messageKind: "user", role: "user", text: "do it", turnId: "t1" },
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
        kind: "message",
        role: "assistant",
        text: "done",
        turnId: "t1",
        messageKind: "assistantResponse",
        messageState: "completed",
      },
    ];

    const blocks = messageStreamLayoutBlocks(items, null);

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
    const items: MessageStreamItem[] = [
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

    const blocks = messageStreamLayoutBlocks(items, null);
    expect(blocks.map((block) => (block.type === "item" ? block.item.id : block.id))).toEqual(["u1", "a1"]);
  });

  it("collapses earlier assistant responses with their turn details", () => {
    const items: MessageStreamItem[] = [
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

    const blocks = messageStreamLayoutBlocks(items, null);
    expect(blocks.map((block) => block.type)).toEqual(["item", "activityGroup", "item"]);
    expect(blocks[1]).toMatchObject({
      summary: "Work details",
      items: [{ item: { id: "a1" } }, { item: { id: "c1" } }, { item: { id: "a2" } }, { item: { id: "f1" } }],
    });
    expect(blocks[2]).toMatchObject({ item: { id: "a3" } });
  });

  it("keeps completed turn work details attached to the final response even when system messages are interleaved", () => {
    const items: MessageStreamItem[] = [
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

    const blocks = messageStreamLayoutBlocks(items, null);

    expect(blocks.map((block) => (block.type === "item" ? block.item.id : block.id))).toEqual(["s1", "s2", "turn-t1-activity", "a1"]);
  });

  it("adds steering markers to completed turn work details without hiding the steering message", () => {
    const items: MessageStreamItem[] = [
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

    const blocks = messageStreamLayoutBlocks(items, null);

    expect(blocks.map((block) => (block.type === "item" ? block.item.id : block.id))).toEqual(["u1", "u2", "turn-t1-activity", "a1"]);
    expect(blocks[2]).toMatchObject({
      summary: "Work details",
      items: [
        { type: "item", item: { id: "c1" } },
        {
          type: "steering",
          id: "steer-activity-u2",
          label: "steer",
          text: "also check tests",
          sourceItemId: "u2",
        },
        { type: "item", item: { id: "c2" } },
      ],
    });
  });

  it("keeps multiple steering markers in completed turn work details", () => {
    const items: MessageStreamItem[] = [
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

    const blocks = messageStreamLayoutBlocks(items, null);
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
    const items: MessageStreamItem[] = [
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

    expect(messageStreamLayoutBlocks(items, "t1").map((block) => block.type)).toEqual(["item", "item"]);
  });

  it("keeps active task progress chronological in the display model", () => {
    const items: MessageStreamItem[] = [
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

    const blocks = messageStreamLayoutBlocks(items, "t1");

    expect(blocks.map((block) => (block.type === "item" ? block.item.id : block.id))).toEqual(["u1", "plan-progress-t1", "a1"]);
  });

  it("groups task progress and agent activity inside completed turn work details", () => {
    const items: MessageStreamItem[] = [
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

    const blocks = messageStreamLayoutBlocks(items, null);
    expect(blocks[1]).toMatchObject({
      summary: "Work details",
      items: [{ item: { id: "plan-progress-t1" } }, { item: { id: "agent-1" } }],
    });
  });

  it("summarizes active subagent states while a turn is running", () => {
    const items: MessageStreamItem[] = [
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

    expect(activeAgentSummary(items, "t1")).toEqual({
      running: 1,
      completed: 1,
      failed: 1,
      agents: [{ threadId: "running", status: "running", messagePreview: null }],
      additionalAgents: 0,
    });
    expect(activeAgentSummary(items, null)).toBeNull();
  });

  it("summarizes active subagent previews and fallback receiver states", () => {
    const items: MessageStreamItem[] = [
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

    expect(activeAgentSummary(items, "t1")).toMatchObject({
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
    const items: MessageStreamItem[] = [
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

    expect(activeAgentSummary(items, "t1")).toBeNull();
  });

  it("adds edited files to the final assistant message", () => {
    const items: MessageStreamItem[] = [
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

    const assistantBlock = messageStreamLayoutBlocks(items, null).find((block) => block.type === "item" && block.item.role === "assistant");
    expect(assistantBlock).toMatchObject({ annotations: { editedFiles: ["src/main.ts", "styles.css"] } });
  });

  it("adds turn diff metadata to the final assistant message only when aggregated diff exists", () => {
    const items: MessageStreamItem[] = [
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

    const withoutDiff = messageStreamLayoutBlocks(items, null).find((block) => block.type === "item" && block.item.role === "assistant");
    expect(withoutDiff).toMatchObject({ annotations: { editedFiles: ["src/main.ts"] } });
    expect(withoutDiff?.type === "item" ? withoutDiff.annotations : null).not.toHaveProperty("turnDiff");

    const withDiff = messageStreamLayoutBlocks(items, null, null, new Map([["t1", "@@\n-old\n+new"]])).find(
      (block) => block.type === "item" && block.item.role === "assistant",
    );
    expect(withDiff).toMatchObject({ annotations: { editedFiles: ["src/main.ts"], turnDiff: { diff: "@@\n-old\n+new" } } });
  });

  it("adds auto-review summaries to the final assistant message", () => {
    const items: MessageStreamItem[] = [
      autoReviewResultItem("review-1", "t1"),
      autoReviewResultItem("review-2", "t1"),
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

    const assistantBlock = messageStreamLayoutBlocks(items, null).find((block) => block.type === "item" && block.item.role === "assistant");
    expect(assistantBlock).toMatchObject({
      annotations: { autoReviewSummaries: ["Auto-review approved: npm test", "Auto-review approved: npm test"] },
    });
  });

  it("does not add edited file or auto-review summaries to active turn messages", () => {
    const items: MessageStreamItem[] = [
      fileChangeItem("f1", "t1", "src/main.ts"),
      autoReviewResultItem("review-1", "t1"),
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

    const assistantBlock = messageStreamLayoutBlocks(items, "t1").find((block) => block.type === "item" && block.item.id === "a1");
    expect(assistantBlock?.type === "item" ? assistantBlock.annotations : null).toBeUndefined();
  });
});

describe("workspace path summaries stay readable without hiding audit paths", () => {
  it("shows edited files relative to the workspace root", () => {
    const items: MessageStreamItem[] = [
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

    const assistantBlock = messageStreamLayoutBlocks(items, null, "/vault/project").find(
      (block) => block.type === "item" && block.item.role === "assistant",
    );
    expect(assistantBlock).toMatchObject({ annotations: { editedFiles: ["/tmp/outside.txt", "src/main.ts", "styles.css"] } });
  });

  it("keeps Windows sibling paths outside the workspace root", () => {
    expect(pathRelativeToRoot("C:\\Vault\\project\\src\\main.ts", "C:\\Vault\\project")).toBe("src/main.ts");
    expect(pathRelativeToRoot("C:\\Vault\\project-other\\src\\main.ts", "C:\\Vault\\project")).toBe("C:/Vault/project-other/src/main.ts");
  });
});

describe("execution state uses typed status adapters before rendered text", () => {
  it("detects failed command state", () => {
    expect(commandExecutionItem({ status: "failed", exitCode: 1 })).toMatchObject({ executionState: "failed" });
  });

  it("does not infer command failure from the command text", () => {
    expect(commandExecutionItem({ command: "echo failed", status: "completed", exitCode: 0 })).toMatchObject({
      executionState: "completed",
    });
  });

  it("uses typed command status before command text", () => {
    expect(commandExecutionItem({ command: "echo completed", status: "inProgress" })).toMatchObject({ executionState: "running" });
  });

  it("keeps command exit code precedence as a Panel display rule", () => {
    expect(commandExecutionItem({ status: "completed", exitCode: 1 })).toMatchObject({ executionState: "failed" });
    expect(commandExecutionItem({ status: "unknown", exitCode: 0 })).toMatchObject({ executionState: "completed" });
  });

  it("maps app-server status strings into Panel execution states", () => {
    expect(fileChangeStreamItem({ status: "declined" })).toMatchObject({ executionState: "failed" });
    expect(mcpToolCallItem({ status: "completed" })).toMatchObject({ executionState: "completed" });
    expect(
      taskProgressMessageStreamItem("turn", "Planning", [
        { step: "Read context", status: "pending" },
        { step: "Patch code", status: "completed" },
      ]),
    ).toMatchObject({ executionState: "running" });
    expect(autoReviewItem("approved")).toMatchObject({ executionState: "completed" });
    expect(autoReviewItem("timedOut")).toMatchObject({ executionState: "failed" });
    expect(hookRunMessageStreamItem(hookRun(), "turn", "completed")).toMatchObject({ executionState: "completed" });
    expect(hookRunMessageStreamItem(hookRun(), "turn", "stopped")).toMatchObject({ executionState: "failed" });
    expect(collabAgentStateExecutionState("inProgress")).toBe("running");
    expect(collabAgentStateExecutionState("failed")).toBe("failed");
  });

  it("uses dynamic tool success as a display fallback", () => {
    expect(dynamicToolCallItem({ status: "unknown", success: true })).toMatchObject({ executionState: "completed" });
    expect(dynamicToolCallItem({ status: "completed", success: false })).toMatchObject({ executionState: "failed" });
  });

  it("does not infer unknown status strings with broad matching", () => {
    expect(fileChangeStreamItem({ status: "done_with_errors" })).toMatchObject({ executionState: null });
    expect(commandExecutionItem({ status: "done_with_errors", exitCode: null })).toMatchObject({ executionState: null });
  });

  it("does not overwrite streamed output with an empty completed item", () => {
    const streamed: MessageStreamItem = {
      id: "c1",
      sourceItemId: "c1",
      kind: "command",
      role: "tool",
      commandAction: "command",
      commandTarget: { kind: "command", commandLine: "Command running" },
      command: "npm test",
      cwd: "/vault",
      status: "running",
      output: "partial output",
    };
    const completed: MessageStreamItem = {
      id: "c1",
      sourceItemId: "c1",
      kind: "command",
      role: "tool",
      commandAction: "command",
      commandTarget: { kind: "command", commandLine: "npm test" },
      command: "npm test",
      cwd: "/vault",
      status: "completed",
      output: "",
    };

    expect(upsertMessageStreamItemById([streamed], completed)[0]).toMatchObject({ output: "partial output", status: "completed" });
  });
});

type CommandExecutionOverrides = Omit<Partial<Extract<TurnItem, { type: "commandExecution" }>>, "status"> & { status?: string };
type FileChangeOverrides = Omit<Partial<Extract<TurnItem, { type: "fileChange" }>>, "status"> & { status?: string };
type McpToolCallOverrides = Omit<Partial<Extract<TurnItem, { type: "mcpToolCall" }>>, "status"> & { status?: string };
type DynamicToolCallOverrides = Omit<Partial<Extract<TurnItem, { type: "dynamicToolCall" }>>, "status"> & { status?: string };

function commandExecutionItem(overrides: CommandExecutionOverrides = {}): MessageStreamItem | null {
  return messageStreamItemFromTurnItem(
    {
      type: "commandExecution",
      id: "command-1",
      command: "npm test",
      cwd: "/vault",
      processId: null,
      source: "agent",
      status: "completed",
      commandActions: [{ type: "unknown", command: "npm test" }],
      aggregatedOutput: null,
      exitCode: null,
      durationMs: null,
      ...overrides,
    } as Extract<TurnItem, { type: "commandExecution" }>,
    "turn",
  );
}

function fileChangeStreamItem(overrides: FileChangeOverrides = {}): MessageStreamItem | null {
  return messageStreamItemFromTurnItem(
    {
      type: "fileChange",
      id: "patch-1",
      status: "completed",
      changes: [{ path: "src/main.ts", kind: { type: "update", move_path: null }, diff: "@@\n-old\n+new" }],
      ...overrides,
    } as Extract<TurnItem, { type: "fileChange" }>,
    "turn",
  );
}

function mcpToolCallItem(overrides: McpToolCallOverrides = {}): MessageStreamItem | null {
  return messageStreamItemFromTurnItem(
    {
      type: "mcpToolCall",
      id: "mcp-1",
      server: "github",
      tool: "pull_request_read",
      status: "completed",
      arguments: { id: 123 },
      appContext: null,
      pluginId: null,
      result: null,
      error: null,
      durationMs: null,
      ...overrides,
    } as Extract<TurnItem, { type: "mcpToolCall" }>,
    "turn",
  );
}

function dynamicToolCallItem(overrides: DynamicToolCallOverrides = {}): MessageStreamItem | null {
  return messageStreamItemFromTurnItem(
    {
      type: "dynamicToolCall",
      id: "dynamic-1",
      namespace: "web",
      tool: "open",
      arguments: { url: "https://example.com" },
      status: "completed",
      contentItems: null,
      success: true,
      durationMs: null,
      ...overrides,
    } as Extract<TurnItem, { type: "dynamicToolCall" }>,
    "turn",
  );
}

function autoReviewItem(status: string): MessageStreamItem {
  return createAutoReviewResultItem({
    threadId: "thread",
    turnId: "turn",
    startedAtMs: 1,
    completedAtMs: 2,
    reviewId: `review-${status}`,
    targetItemId: "target-1",
    decisionSource: "agent",
    review: { status, riskLevel: "low", userAuthorization: "medium", rationale: "Allowed by policy." },
    action: { type: "applyPatch", cwd: "/vault", files: ["/vault/src/main.ts"] },
  });
}

function hookRun() {
  return {
    id: "hook-1",
    eventName: "postToolUse",
    statusMessage: "Formatted 1 file.",
    startedAt: 1n,
    durationMs: 1n,
    entries: [{ kind: "feedback", text: "ok" }],
  };
}
