import { describe, expect, it } from "vitest";
import { appServerTurnInputFromCodexInput } from "../../../../../src/app-server/protocol/request-input";
import type { TurnItem, TurnRecord } from "../../../../../src/app-server/protocol/turn";
import { collabAgentStateExecutionState } from "../../../../../src/features/chat/app-server/mappers/thread-stream/execution-state";
import { hookRunThreadStreamItem } from "../../../../../src/features/chat/app-server/mappers/thread-stream/hook-run-items";
import { autoReviewPermissionRows } from "../../../../../src/features/chat/app-server/mappers/thread-stream/permission-rows";
import {
  createAutoReviewResultItem,
  createReviewResultItem,
} from "../../../../../src/features/chat/app-server/mappers/thread-stream/review-result-items";
import { taskProgressThreadStreamItem } from "../../../../../src/features/chat/app-server/mappers/thread-stream/task-progress";
import {
  threadStreamItemFromTurnItem,
  threadStreamItemsFromTurns,
} from "../../../../../src/features/chat/app-server/mappers/thread-stream/turn-items";
import type { ThreadStreamItem } from "../../../../../src/features/chat/domain/thread-stream/items";

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
      threadStreamItemsFromTurns(turns)
        .filter((item) => item.kind === "dialogue")
        .map((item) => item.text),
    ).toEqual(["hello", "world"]);
    expect(threadStreamItemFromTurnItem(userMessage)).toMatchObject({ role: "user", copyText: "hello" });
    expect(threadStreamItemFromTurnItem(assistantMessage)).toMatchObject({ role: "assistant", copyText: "world" });
  });

  it("restores v2 context metadata without exposing its descriptor", () => {
    const clientId = "local-user-1-seed-1-1";
    const prepared = appServerTurnInputFromCodexInput(
      [
        { type: "text", text: "この続きです" },
        {
          type: "additionalContext",
          key: "codex_panel_referenced_thread",
          kind: "untrusted",
          value: "old request\nold response",
          attachment: {
            kind: "referencedThread",
            threadId: "thread-reference",
            includedTurns: 2,
            turnLimit: 20,
            omittedTurns: 3,
            truncated: true,
          },
        },
      ],
      clientId,
    );

    expect(
      threadStreamItemFromTurnItem({
        type: "userMessage",
        id: "u1",
        clientId,
        content: prepared.input,
      }),
    ).toMatchObject({
      text: "この続きです",
      copyText: "この続きです",
      referencedThread: {
        threadId: "thread-reference",
        title: "thread-r",
        includedTurns: 2,
        omittedTurns: 3,
        truncated: true,
      },
    });
  });

  it("restores v2 file references from app-server history after a thread resume", () => {
    const clientId = "local-user-1-seed-1-1";
    const prepared = appServerTurnInputFromCodexInput(
      [
        { type: "text", text: "Read [[Alpha]] and the current note." },
        { type: "fileReference", name: "Alpha", path: "thoughts/Alpha.md" },
        { type: "fileReference", name: "<active>", path: "Daily/Today.md" },
      ],
      clientId,
    );

    expect(
      threadStreamItemFromTurnItem({
        type: "userMessage",
        id: "u1",
        clientId,
        content: prepared.input,
      }),
    ).toMatchObject({
      text: "Read [[Alpha]] and the current note.",
      copyText: "Read [[Alpha]] and the current note.",
      referencedFiles: [
        { name: "Alpha", path: "thoughts/Alpha.md" },
        { name: "Active file", path: "Daily/Today.md" },
      ],
    });
  });

  it("restores v2 metadata when resume merges text before a non-text input", () => {
    const clientId = "local-user-1-seed-1-1";
    const prepared = appServerTurnInputFromCodexInput(
      [
        { type: "text", text: "Read [[Alpha]]." },
        { type: "fileReference", name: "Alpha", path: "thoughts/Alpha.md" },
        { type: "localImage", path: "/tmp/chart.png" },
      ],
      clientId,
    );
    const normalizedText = prepared.input.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("");
    const nonTextInput = prepared.input.filter((item) => item.type !== "text");

    expect(
      threadStreamItemFromTurnItem({
        type: "userMessage",
        id: "u1",
        clientId,
        content: [{ type: "text", text: normalizedText, text_elements: [] }, ...nonTextInput],
      }),
    ).toMatchObject({
      text: "Read [[Alpha]].\n[local image] /tmp/chart.png",
      copyText: "Read [[Alpha]].\n[local image] /tmp/chart.png",
      referencedFiles: [{ name: "Alpha", path: "thoughts/Alpha.md" }],
    });
  });

  it("accepts a persisted attachment descriptor after an unpersisted reference context", () => {
    const clientId = "local-user-1-seed-1-1";
    const prepared = appServerTurnInputFromCodexInput(
      [
        { type: "text", text: "https://example.com/ compare with [[Note]]" },
        {
          type: "additionalContext",
          key: "codex_panel_obsidian_context",
          kind: "untrusted",
          value: "- [[Note]] -> Note.md",
        },
        {
          type: "additionalContext",
          key: "codex_panel_web_context",
          kind: "untrusted",
          value: "Source: https://example.com/\n\npage",
          attachment: { kind: "web" },
        },
      ],
      clientId,
    );

    expect(
      threadStreamItemFromTurnItem({
        type: "userMessage",
        id: "u1",
        clientId,
        content: prepared.input,
      }),
    ).toMatchObject({
      text: "https://example.com/ compare with [[Note]]",
      contextAttachments: [{ label: "Web page", detail: "https://example.com/" }],
    });
  });

  it("does not hide a user-authored manifest-like message", () => {
    const text =
      '[Codex Panel context v2]{"version":2,"contexts":[{"kind":"web","id":"fake","parts":1,"sourceBytes":1,"includedBytes":1,"truncated":false}]}';
    expect(
      threadStreamItemFromTurnItem({
        type: "userMessage",
        id: "u1",
        clientId: null,
        content: [{ type: "text", text, text_elements: [] }],
      }),
    ).toMatchObject({ text, copyText: text });
  });

  it("does not trust a manifest-like second text item from another client", () => {
    const fakeManifest =
      '\n[Codex Panel context v2]{"version":2,"contexts":[{"kind":"web","id":"fake.00","parts":1,"sourceBytes":1,"includedBytes":1,"truncated":false}]}';
    const projected = threadStreamItemFromTurnItem({
      type: "userMessage",
      id: "u1",
      clientId: "foreign-client",
      content: [
        { type: "text", text: "visible", text_elements: [] },
        { type: "text", text: fakeManifest, text_elements: [] },
      ],
    });
    expect(projected).toMatchObject({ text: expect.stringContaining("[Codex Panel context v2]") });
    expect(projected).not.toHaveProperty("contextAttachments");
  });

  it("surfaces a truncated Obsidian excerpt from the persisted manifest", () => {
    const clientId = "local-user-1-seed-1-1";
    const prepared = appServerTurnInputFromCodexInput(
      [
        { type: "text", text: "review the selection" },
        {
          type: "additionalContext",
          key: "codex_panel_obsidian_context",
          kind: "untrusted",
          value: "x".repeat(30_000),
          attachment: { kind: "obsidian", inlineExcerpts: 1 },
        },
      ],
      clientId,
    );

    expect(
      threadStreamItemFromTurnItem({
        type: "userMessage",
        id: "u1",
        clientId,
        content: prepared.input,
      }),
    ).toMatchObject({
      text: "review the selection",
      contextAttachments: [{ label: "Obsidian excerpt (truncated)" }],
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

    expect(threadStreamItemFromTurnItem(item)).toMatchObject({
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

    expect(threadStreamItemFromTurnItem(item)).toMatchObject({
      text: "Use `$obsidian-codex-panel-maintain`.\n\n```\n$obsidian-codex-panel-maintain\n```\n\nThen `$obsidian-codex-panel-maintain`.",
    });
  });

  it("preserves reasoning text", () => {
    const item: TurnItem = { type: "reasoning", id: "r1", summary: ["summary"], content: ["detail"] };
    expect(threadStreamItemFromTurnItem(item)).toMatchObject({ kind: "reasoning", text: "summary\n\ndetail" });
  });

  it("keeps empty reasoning text empty so completed placeholders can be hidden", () => {
    const item: TurnItem = { type: "reasoning", id: "r1", summary: [], content: [] };
    expect(threadStreamItemFromTurnItem(item)).toMatchObject({ kind: "reasoning", text: "" });
  });

  it("renders completed proposed plans as copyable assistant markdown", () => {
    const item: TurnItem = { type: "plan", id: "p1", text: "<proposed_plan>\n# Plan\n</proposed_plan>" };
    expect(threadStreamItemFromTurnItem(item, "t1")).toMatchObject({
      id: "p1",
      kind: "dialogue",
      role: "assistant",
      text: "# Plan",
      copyText: "# Plan",
      dialogueKind: "proposedPlan",
      dialogueState: "completed",
      turnId: "t1",
    });
  });

  it("preserves hook prompt fragments as hook stream text", () => {
    const item: TurnItem = {
      type: "hookPrompt",
      id: "hook-prompt-1",
      fragments: [
        { text: "First hook prompt", hookRunId: "hook-run-1" },
        { text: "Second hook prompt", hookRunId: "hook-run-2" },
      ],
    };

    expect(threadStreamItemFromTurnItem(item, "t1")).toMatchObject({
      id: "hook-prompt-1",
      kind: "hook",
      role: "tool",
      text: "First hook prompt\n\nSecond hook prompt",
      turnId: "t1",
      sourceItemId: "hook-prompt-1",
      provenance: {
        source: "appServer",
        channel: "turnItem",
        itemType: "hookPrompt",
        itemId: "hook-prompt-1",
      },
    });
  });

  it("formats structured plan progress as task progress", () => {
    expect(
      taskProgressThreadStreamItem("t1", "Working plan", [
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

    expect(threadStreamItemFromTurnItem(item, "t1")).toMatchObject({
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
      agents: [{ threadId: "child-thread", status: "completed", executionState: "completed", message: "Done" }],
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

    expect(threadStreamItemFromTurnItem(item, "t1")).toMatchObject({
      kind: "agent",
      status: "completed",
      executionState: "completed",
    });
  });

  it.each([
    {
      name: "failed agent over running and completed agents",
      status: "completed",
      receiverThreadIds: ["failed", "running", "completed"],
      agentsStates: {
        completed: { status: "completed", message: null },
        running: { status: "running", message: null },
        failed: { status: "errored", message: null },
      },
      executionState: "failed",
    },
    {
      name: "running agent over completed agents",
      status: "completed",
      receiverThreadIds: ["running", "completed"],
      agentsStates: {
        completed: { status: "completed", message: null },
        running: { status: "running", message: null },
      },
      executionState: "running",
    },
    {
      name: "all completed agents",
      status: "inProgress",
      receiverThreadIds: ["first", "second"],
      agentsStates: {
        first: { status: "completed", message: null },
        second: { status: "shutdown", message: null },
      },
      executionState: "completed",
    },
    {
      name: "receiver awaiting its first state",
      status: "completed",
      receiverThreadIds: ["waiting"],
      agentsStates: {},
      executionState: "running",
    },
    {
      name: "unknown status when neither source supplies a known state",
      status: "futureStatus",
      receiverThreadIds: [],
      agentsStates: {},
      executionState: null,
    },
  ] as const)("derives follow-up agent activity from $name", ({ status, receiverThreadIds, agentsStates, executionState }) => {
    expect(
      threadStreamItemFromTurnItem(
        collabAgentToolCall({
          status,
          receiverThreadIds: [...receiverThreadIds],
          agentsStates,
        }),
        "t1",
      ),
    ).toMatchObject({ kind: "agent", executionState });
  });

  it.each([
    ["sendInput", "failed", "failed"],
    ["wait", "inProgress", "running"],
  ] as const)("falls back to the %s tool-call status without agent states", (tool, status, executionState) => {
    expect(threadStreamItemFromTurnItem(collabAgentToolCall({ tool, status }), "t1")).toMatchObject({
      kind: "agent",
      executionState,
    });
  });

  it("orders agent summaries by thread id independently of protocol object insertion order", () => {
    const converted = threadStreamItemFromTurnItem(
      collabAgentToolCall({
        agentsStates: {
          "thread-z": { status: "completed", message: "Last" },
          "thread-a": { status: "running", message: "First" },
          "thread-m": undefined,
        },
      }),
      "t1",
    );

    expect(converted).toMatchObject({
      kind: "agent",
      agents: [
        { threadId: "thread-a", status: "running", message: "First" },
        { threadId: "thread-m", status: "unknown", message: null },
        { threadId: "thread-z", status: "completed", message: "Last" },
      ],
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

    expect(threadStreamItemFromTurnItem(item, "t1")).toMatchObject({
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

    expect(threadStreamItemFromTurnItem(item, "t1")).toMatchObject({
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

    expect(threadStreamItemFromTurnItem(item, "t1")).toMatchObject({
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

    expect(threadStreamItemFromTurnItem(item, "t1")).toMatchObject({
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

    expect(threadStreamItemFromTurnItem(item, "t1")).toMatchObject({
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

    expect(threadStreamItemFromTurnItem(item, "t1")).toEqual({
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

    expect(threadStreamItemFromTurnItem(entered, "t1")).toMatchObject({
      kind: "tool",
      toolName: "enteredReviewMode",
      primaryTarget: { kind: "value", value: "Entered review mode" },
      output: "Review started",
    });
    expect(threadStreamItemFromTurnItem(exited, "t1")).toMatchObject({
      kind: "tool",
      toolName: "exitedReviewMode",
      primaryTarget: { kind: "value", value: "Exited review mode" },
      output: "Review finished",
    });
  });

  it("preserves context compaction items as short status items", () => {
    const item: TurnItem = { type: "contextCompaction", id: "compact-1" };

    expect(threadStreamItemFromTurnItem(item, "t1")).toMatchObject({
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

  it.each([
    {
      name: "network access",
      action: {
        type: "networkAccess",
        target: "api.example.com:443",
        host: "api.example.com",
        protocol: "https",
        port: 443,
      },
      summary: "https://api.example.com:443",
      auditFacts: [
        { key: "action", value: "network access" },
        { key: "target", value: "api.example.com:443" },
        { key: "protocol", value: "https" },
        { key: "host", value: "api.example.com" },
        { key: "port", value: "443" },
      ],
    },
    {
      name: "MCP tool call with connector metadata",
      action: {
        type: "mcpToolCall",
        server: "calendar",
        toolName: "create_event",
        connectorId: "connector-1",
        connectorName: "Work Calendar",
        toolTitle: "Create event",
      },
      summary: "calendar.create_event",
      auditFacts: [
        { key: "action", value: "MCP tool call" },
        { key: "server", value: "calendar" },
        { key: "tool", value: "create_event" },
        { key: "title", value: "Create event" },
        { key: "connector", value: "Work Calendar" },
        { key: "connector id", value: "connector-1" },
      ],
    },
    {
      name: "MCP tool call without connector metadata",
      action: {
        type: "mcpToolCall",
        server: "filesystem",
        toolName: "read_file",
        connectorId: null,
        connectorName: null,
        toolTitle: null,
      },
      summary: "filesystem.read_file",
      auditFacts: [
        { key: "action", value: "MCP tool call" },
        { key: "server", value: "filesystem" },
        { key: "tool", value: "read_file" },
      ],
    },
    {
      name: "permission request with a reason",
      action: {
        type: "requestPermissions",
        reason: "Read project notes and contact the API.",
        permissions: {
          network: { enabled: true },
          fileSystem: {
            entries: [
              { path: { type: "path", path: "/vault/notes.md" }, access: "read" },
              { path: { type: "glob_pattern", pattern: "/vault/**/*.md" }, access: "write" },
            ],
          },
        },
      },
      summary: "Read project notes and contact the API.",
      auditFacts: [
        { key: "action", value: "request permissions" },
        { key: "reason", value: "Read project notes and contact the API." },
        { key: "network", value: "enabled" },
        { key: "filesystem", value: "/vault/notes.md (read)\n/vault/**/*.md (write)" },
      ],
    },
    {
      name: "permission request without a reason",
      action: {
        type: "requestPermissions",
        reason: null,
        permissions: {
          network: { enabled: false },
          fileSystem: {
            entries: [{ path: { type: "special", value: { kind: "project_roots", subpath: "src" } }, access: "read" }],
          },
        },
      },
      summary: "permission request",
      auditFacts: [
        { key: "action", value: "request permissions" },
        { key: "network", value: "disabled" },
        { key: "filesystem", value: "project_roots/src (read)" },
      ],
    },
  ] as const)("preserves $name audit history from start through completion", ({ action, summary, auditFacts }) => {
    const base = {
      threadId: "thread",
      turnId: "turn",
      startedAtMs: 1,
      reviewId: "review-1",
      targetItemId: null,
      action,
    };

    const started = createAutoReviewResultItem({
      ...base,
      review: { status: "inProgress", riskLevel: null, userAuthorization: null, rationale: null },
    });
    expect(started).toMatchObject({
      kind: "reviewResult",
      text: `Auto-review started: ${summary}`,
      executionState: "running",
    });
    if (started.kind !== "reviewResult") throw new Error("Expected an auto-review result item");
    expect(started.review?.auditFacts).toEqual([{ key: "status", value: "inProgress" }, ...auditFacts]);

    const completed = createAutoReviewResultItem({
      ...base,
      completedAtMs: 2,
      decisionSource: "agent",
      review: { status: "approved", riskLevel: null, userAuthorization: null, rationale: null },
    });
    expect(completed).toMatchObject({
      kind: "reviewResult",
      text: `Auto-review approved: ${summary}`,
      executionState: "completed",
    });
    if (completed.kind !== "reviewResult") throw new Error("Expected an auto-review result item");
    expect(completed.review?.auditFacts).toEqual([{ key: "status", value: "approved" }, { key: "source", value: "agent" }, ...auditFacts]);
  });
});

describe("auto-review permission detail rows", () => {
  it("formats app-server permission paths without exposing raw payloads", () => {
    expect(
      autoReviewPermissionRows({
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
      taskProgressThreadStreamItem("turn", "Planning", [
        { step: "Read context", status: "pending" },
        { step: "Patch code", status: "completed" },
      ]),
    ).toMatchObject({ executionState: "running" });
    expect(autoReviewItem("approved")).toMatchObject({ executionState: "completed" });
    expect(autoReviewItem("timedOut")).toMatchObject({ executionState: "failed" });
    expect(hookRunThreadStreamItem(hookRun(), "turn", "completed")).toMatchObject({ executionState: "completed" });
    expect(hookRunThreadStreamItem(hookRun(), "turn", "stopped")).toMatchObject({ executionState: "failed" });
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
});

type CommandExecutionOverrides = Omit<Partial<Extract<TurnItem, { type: "commandExecution" }>>, "status"> & { status?: string };
type FileChangeOverrides = Omit<Partial<Extract<TurnItem, { type: "fileChange" }>>, "status"> & { status?: string };
type McpToolCallOverrides = Omit<Partial<Extract<TurnItem, { type: "mcpToolCall" }>>, "status"> & { status?: string };
type DynamicToolCallOverrides = Omit<Partial<Extract<TurnItem, { type: "dynamicToolCall" }>>, "status"> & { status?: string };
type CollabAgentToolCallOverrides = Omit<Partial<Extract<TurnItem, { type: "collabAgentToolCall" }>>, "status"> & { status?: string };

function collabAgentToolCall(overrides: CollabAgentToolCallOverrides = {}): TurnItem {
  return {
    type: "collabAgentToolCall",
    id: "agent-follow-up",
    tool: "sendInput",
    status: "inProgress",
    senderThreadId: "parent-thread",
    receiverThreadIds: [],
    prompt: "Continue.",
    model: null,
    reasoningEffort: null,
    agentsStates: {},
    ...overrides,
  } as Extract<TurnItem, { type: "collabAgentToolCall" }>;
}

function commandExecutionItem(overrides: CommandExecutionOverrides = {}): ThreadStreamItem | null {
  return threadStreamItemFromTurnItem(
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

function fileChangeStreamItem(overrides: FileChangeOverrides = {}): ThreadStreamItem | null {
  return threadStreamItemFromTurnItem(
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

function mcpToolCallItem(overrides: McpToolCallOverrides = {}): ThreadStreamItem | null {
  return threadStreamItemFromTurnItem(
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

function dynamicToolCallItem(overrides: DynamicToolCallOverrides = {}): ThreadStreamItem | null {
  return threadStreamItemFromTurnItem(
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

function autoReviewItem(status: string): ThreadStreamItem {
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
