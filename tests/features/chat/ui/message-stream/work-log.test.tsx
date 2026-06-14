// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import type { MessageStreamItem } from "../../../../../src/features/chat/domain/message-stream/items";
import { topLevelDetailsSummaries } from "../../../../support/dom";
import "./setup";
import {
  emptyDisclosures,
  expectPresent,
  idleTurnLifecycle,
  messageStreamBlocks,
  renderMessageBlockElement,
  renderMessageStreamBlocksInAct,
  runningTurnLifecycle,
  testDisclosures,
  unmountUiRootInAct,
} from "./test-helpers";

describe("work log renderer decisions", () => {
  it("renders generic tool details as visible sections inside one details block", () => {
    const block = messageStreamBlocks({
      activeThreadId: "thread",
      turnLifecycle: runningTurnLifecycle("turn"),
      historyCursor: null,
      loadingHistory: false,
      items: [
        {
          id: "tool-1",
          kind: "tool",
          role: "tool",
          text: "123",
          toolName: "github.pull_request_read",
          turnId: "turn",
          status: "completed",
          toolCall: {
            arguments: { id: 123 },
            result: { ok: true },
          },
        },
      ],
      disclosures: emptyDisclosures(),
      forkActionsItemId: null,
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
    })[0];

    const element = renderMessageBlockElement(block);

    expect(element.querySelector(".codex-panel__tool-summary")?.textContent).toBe("123");
    expect(topLevelDetailsSummaries(element)).toEqual(["github.pull_request_read"]);
    expect([...element.querySelectorAll("details summary")].map((summary) => summary.textContent)).toEqual(["github.pull_request_read"]);
    expect(element.querySelector<HTMLElement>("details summary")?.tabIndex).toBe(-1);
    expect(element.textContent).not.toContain("Details");
    expect([...element.querySelectorAll(".codex-panel__output-title")].map((title) => title.textContent)).toEqual([
      "Arguments JSON",
      "Result JSON",
    ]);
  });

  it("renders steering activity as a compact two-line tool summary", () => {
    const block = messageStreamBlocks({
      activeThreadId: "thread",
      turnLifecycle: idleTurnLifecycle(),
      historyCursor: null,
      loadingHistory: false,
      items: [
        { id: "u1", kind: "message", messageKind: "user", role: "user", text: "do it", turnId: "turn" },
        {
          id: "u2",
          kind: "message",
          messageKind: "user",
          role: "user",
          text: "also check tests and keep the summary compact",
          turnId: "turn",
        },
        {
          id: "a1",
          kind: "message",
          role: "assistant",
          text: "done",
          messageKind: "assistantResponse",
          messageState: "completed",
          turnId: "turn",
        },
      ],
      disclosures: testDisclosures({ activityGroups: ["turn"] }),
      forkActionsItemId: null,
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
    }).find((item) => item.key === "activity:turn-turn-activity");

    const element = renderMessageBlockElement(expectPresent(block));

    expect(element.querySelector(".codex-panel__tool-result-header")?.textContent).toBe("steer");
    expect(element.querySelector(".codex-panel__tool-summary")?.textContent).toBe("also check tests and keep the summary compact");
  });

  it("renders path summary tools relative to the workspace root", () => {
    const block = messageStreamBlocks({
      activeThreadId: "thread",
      turnLifecycle: runningTurnLifecycle("turn"),
      historyCursor: null,
      loadingHistory: false,
      workspaceRoot: "/vault/project",
      items: [
        {
          id: "tool-path",
          kind: "tool",
          role: "tool",
          text: "/vault/project/assets/image.png",
          toolName: "imageView",
          primaryTarget: { kind: "path", path: "/vault/project/assets/image.png" },
          turnId: "turn",
        },
      ],
      disclosures: emptyDisclosures(),
      forkActionsItemId: null,
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
    })[0];

    const element = renderMessageBlockElement(block);

    expect(element.querySelector(".codex-panel__tool-summary")?.textContent).toBe("assets/image.png");
    expect(element.querySelector(".codex-panel__tool-summary")?.getAttribute("title")).toBeNull();
  });

  it("derives generic tool summaries from primary targets instead of item text", () => {
    const block = messageStreamBlocks({
      activeThreadId: "thread",
      turnLifecycle: runningTurnLifecycle("turn"),
      historyCursor: null,
      loadingHistory: false,
      workspaceRoot: "/vault/project",
      items: [
        {
          id: "tool-1",
          kind: "tool",
          role: "tool",
          text: "legacy text",
          toolName: "web search",
          operation: "search",
          primaryTarget: { kind: "value", value: "codex app-server" },
          turnId: "turn",
        },
      ],
      disclosures: emptyDisclosures(),
      forkActionsItemId: null,
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
    })[0];

    const element = renderMessageBlockElement(block);

    expect(element.querySelector(".codex-panel__tool-summary")?.textContent).toBe("search: codex app-server");
  });

  it("updates path summary tools when the workspace root changes", () => {
    const parent = document.createElement("div");
    const item = {
      id: "tool-path",
      kind: "tool",
      role: "tool",
      text: "/vault/project/assets/image.png",
      toolName: "imageView",
      primaryTarget: { kind: "path", path: "/vault/project/assets/image.png" },
      turnId: "turn",
    } as const;
    const baseContext = {
      activeThreadId: "thread",
      turnLifecycle: runningTurnLifecycle("turn"),
      historyCursor: null,
      loadingHistory: false,
      items: [item] satisfies MessageStreamItem[],
      disclosures: emptyDisclosures(),
      forkActionsItemId: null,
      loadOlderTurns: vi.fn(),
      renderMarkdown: (element: HTMLElement, text: string) => element.createDiv({ text }),
    };

    renderMessageStreamBlocksInAct(parent, messageStreamBlocks({ ...baseContext, workspaceRoot: "/vault" }));
    expect(parent.querySelector(".codex-panel__tool-summary")?.textContent).toBe("project/assets/image.png");

    renderMessageStreamBlocksInAct(parent, messageStreamBlocks({ ...baseContext, workspaceRoot: "/vault/project" }));
    expect(parent.querySelector(".codex-panel__tool-summary")?.textContent).toBe("assets/image.png");
    unmountUiRootInAct(parent);
  });

  it("keeps path summary tools absolute outside the workspace root", () => {
    const block = messageStreamBlocks({
      activeThreadId: "thread",
      turnLifecycle: runningTurnLifecycle("turn"),
      historyCursor: null,
      loadingHistory: false,
      workspaceRoot: "/vault/project",
      items: [
        {
          id: "tool-path",
          kind: "tool",
          role: "tool",
          text: "/tmp/image.png",
          toolName: "imageView",
          primaryTarget: { kind: "path", path: "/tmp/image.png" },
          turnId: "turn",
        },
      ],
      disclosures: emptyDisclosures(),
      forkActionsItemId: null,
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
    })[0];

    const element = renderMessageBlockElement(block);

    expect(element.querySelector(".codex-panel__tool-summary")?.textContent).toBe("/tmp/image.png");
  });

  it("does not treat generic tool summaries as paths without an explicit marker", () => {
    const block = messageStreamBlocks({
      activeThreadId: "thread",
      turnLifecycle: runningTurnLifecycle("turn"),
      historyCursor: null,
      loadingHistory: false,
      workspaceRoot: "/vault/project",
      items: [
        {
          id: "tool-path-like",
          kind: "tool",
          role: "tool",
          text: "/vault/project",
          toolName: "example.tool",
          turnId: "turn",
        },
      ],
      disclosures: emptyDisclosures(),
      forkActionsItemId: null,
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
    })[0];

    const element = renderMessageBlockElement(block);

    expect(element.querySelector(".codex-panel__tool-summary")?.textContent).toBe("/vault/project");
  });

  it("renders hook metadata as rows inside one details block", () => {
    const block = messageStreamBlocks({
      activeThreadId: "thread",
      turnLifecycle: runningTurnLifecycle("turn"),
      historyCursor: null,
      loadingHistory: false,
      items: [
        {
          id: "hook-1",
          kind: "hook",
          role: "tool",
          text: "postToolUse: Formatted 1 file.",
          toolName: "hook",
          turnId: "turn",
          status: "completed",
          hookRun: {
            eventName: "postToolUse",
            statusMessage: "Formatted 1 file.",
            durationMs: "1ms",
            entries: [{ kind: "feedback", text: "ok" }],
          },
        },
      ],
      disclosures: emptyDisclosures(),
      forkActionsItemId: null,
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
    })[0];

    const element = renderMessageBlockElement(block);

    expect(topLevelDetailsSummaries(element)).toEqual(["hook"]);
    expect([...element.querySelectorAll("details summary")].map((summary) => summary.textContent)).toEqual(["hook"]);
    expect(element.querySelector(".codex-panel__tool-summary")?.textContent).toBe("postToolUse: Formatted 1 file.");
    expect(element.textContent).not.toContain("Details");
    expect(element.querySelector(".codex-panel__meta-grid")?.textContent).toContain("statuscompleted");
    expect(element.querySelector(".codex-panel__meta-grid")?.textContent).toContain("eventpostToolUse");
    expect(element.querySelector(".codex-panel__meta-grid")?.textContent).toContain("messageFormatted 1 file.");
    expect([...element.querySelectorAll(".codex-panel__output-title")].map((title) => title.textContent)).toEqual(["Hook output"]);
    expect(element.querySelector(".codex-panel__output pre")?.textContent).toBe("feedback: ok");
  });

  it("renders hook metadata when the hook is inside a completed-turn activity group", () => {
    const blocks = messageStreamBlocks({
      activeThreadId: "thread",
      turnLifecycle: idleTurnLifecycle(),
      historyCursor: null,
      loadingHistory: false,
      items: [
        { id: "u1", kind: "message", messageKind: "user", role: "user", text: "do it", turnId: "turn" },
        {
          id: "hook-1",
          kind: "hook",
          role: "tool",
          text: "postToolUse: Formatted 1 file.",
          toolName: "hook",
          turnId: "turn",
          status: "completed",
          hookRun: {
            eventName: "postToolUse",
            statusMessage: "Formatted 1 file.",
            entries: [{ kind: "feedback", text: "ok" }],
          },
        },
        {
          id: "a1",
          kind: "message",
          role: "assistant",
          text: "done",
          turnId: "turn",
          messageKind: "assistantResponse",
          messageState: "completed",
        },
      ],
      disclosures: testDisclosures({ activityGroups: ["turn"], toolResults: ["hook-1"] }),
      forkActionsItemId: null,
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
    });

    const element = renderMessageBlockElement(expectPresent(blocks.find((block) => block.key === "activity:turn-turn-activity")));

    expect(element).toBeDefined();
    expect(element.querySelector(":scope > summary")?.textContent).toBe("Work details: hook");
    expect(element.querySelector(".codex-panel__tool-summary")?.textContent).toBe("postToolUse: Formatted 1 file.");
    expect(element.querySelector(".codex-panel__meta-grid")?.textContent).toContain("statuscompleted");
    expect(element.querySelector(".codex-panel__meta-grid")?.textContent).toContain("eventpostToolUse");
    expect(element.querySelector(".codex-panel__output-title")?.textContent).toBe("Hook output");
    expect(element.querySelector(".codex-panel__output pre")?.textContent).toBe("feedback: ok");
  });

  it("renders task progress items as a dedicated task list", () => {
    const block = messageStreamBlocks({
      activeThreadId: "thread",
      turnLifecycle: runningTurnLifecycle("turn"),
      historyCursor: null,
      loadingHistory: false,
      items: [
        {
          id: "plan-progress-turn",
          kind: "taskProgress",
          role: "tool",
          text: "Plan\n[>] Patch UI",
          turnId: "turn",
          explanation: "Plan",
          steps: [
            { step: "Inspect code", status: "completed" },
            { step: "Patch UI", status: "inProgress" },
          ],
          status: "inProgress",
        },
      ],
      disclosures: emptyDisclosures(),
      forkActionsItemId: null,
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
    })[0];

    const element = renderMessageBlockElement(block);

    expect(element.classList.contains("codex-panel__work-message")).toBe(true);
    expect(element.classList.contains("codex-panel__task-progress")).toBe(true);
    expect(element.querySelector(".codex-panel__message-role")?.textContent).toBe("tasks");
    expect(element.textContent).toContain("[x]Inspect code");
    expect(element.textContent).toContain("[>]Patch UI");
  });

  it("renders active task progress with the shared bottom live blocks", () => {
    const blocks = messageStreamBlocks({
      activeThreadId: "thread",
      turnLifecycle: runningTurnLifecycle("turn"),
      historyCursor: null,
      loadingHistory: false,
      items: [
        { id: "u1", kind: "message", messageKind: "user", role: "user", text: "Do it", turnId: "turn" },
        {
          id: "plan-progress-turn",
          kind: "taskProgress",
          role: "tool",
          text: "[>] Patch UI",
          turnId: "turn",
          explanation: null,
          steps: [{ step: "Patch UI", status: "inProgress" }],
          status: "inProgress",
        },
        {
          id: "a1",
          kind: "message",
          role: "assistant",
          text: "Working",
          turnId: "turn",
          messageKind: "assistantResponse",
          messageState: "completed",
        },
        {
          id: "agent-1",
          kind: "agent",
          role: "tool",
          text: "Wait for agent",
          turnId: "turn",
          tool: "wait",
          status: "running",
          senderThreadId: "parent",
          receiverThreadIds: ["running"],
          prompt: null,
          model: null,
          reasoningEffort: null,
          agents: [{ threadId: "running", status: "running", message: "Inspecting renderer" }],
        },
      ],
      disclosures: emptyDisclosures(),
      forkActionsItemId: null,
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
      pendingRequests: {
        signature: "request:1",
        snapshot: () => ({
          approvals: [],
          pendingUserInputs: [],
          userInputDrafts: new Map(),
          approvalDetails: new Set(),
        }),
        actions: () => ({
          resolveApproval: vi.fn(),
          resolveUserInput: vi.fn(),
          cancelUserInput: vi.fn(),
          setUserInputDraft: vi.fn(),
        }),
        consumeAutoFocus: () => false,
      },
    });

    expect(blocks.map((block) => block.key)).toEqual([
      "item:u1",
      "item:a1",
      "item:agent-1",
      "live-task:plan-progress-turn",
      "live-agents:turn",
      "pending-requests",
    ]);
  });

  it("orders shared bottom live blocks by insertion order", () => {
    const blocks = messageStreamBlocks({
      activeThreadId: "thread",
      turnLifecycle: runningTurnLifecycle("turn"),
      historyCursor: null,
      loadingHistory: false,
      items: [
        { id: "u1", kind: "message", messageKind: "user", role: "user", text: "Do it", turnId: "turn" },
        {
          id: "agent-1",
          kind: "agent",
          role: "tool",
          text: "Wait for agent",
          turnId: "turn",
          tool: "wait",
          status: "running",
          senderThreadId: "parent",
          receiverThreadIds: ["running"],
          prompt: null,
          model: null,
          reasoningEffort: null,
          agents: [{ threadId: "running", status: "running", message: null }],
        },
        {
          id: "plan-progress-turn",
          kind: "taskProgress",
          role: "tool",
          text: "[>] Patch UI",
          turnId: "turn",
          explanation: null,
          steps: [{ step: "Patch UI", status: "inProgress" }],
          status: "inProgress",
        },
      ],
      disclosures: emptyDisclosures(),
      forkActionsItemId: null,
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
    });

    expect(blocks.map((block) => block.key)).toEqual(["item:u1", "item:agent-1", "live-agents:turn", "live-task:plan-progress-turn"]);
  });

  it("anchors the live agent summary at the first agent activity", () => {
    const blocks = messageStreamBlocks({
      activeThreadId: "thread",
      turnLifecycle: runningTurnLifecycle("turn"),
      historyCursor: null,
      loadingHistory: false,
      items: [
        { id: "u1", kind: "message", messageKind: "user", role: "user", text: "Do it", turnId: "turn" },
        {
          id: "agent-spawn",
          kind: "agent",
          role: "tool",
          text: "Spawn agent",
          turnId: "turn",
          tool: "spawnAgent",
          status: "completed",
          senderThreadId: "parent",
          receiverThreadIds: ["child"],
          prompt: "Inspect the renderer.",
          model: null,
          reasoningEffort: null,
          agents: [{ threadId: "child", status: "completed", message: null }],
        },
        {
          id: "plan-progress-turn",
          kind: "taskProgress",
          role: "tool",
          text: "[>] Patch UI",
          turnId: "turn",
          explanation: null,
          steps: [{ step: "Patch UI", status: "inProgress" }],
          status: "inProgress",
        },
        {
          id: "agent-wait",
          kind: "agent",
          role: "tool",
          text: "Wait for agent",
          turnId: "turn",
          tool: "wait",
          status: "running",
          senderThreadId: "parent",
          receiverThreadIds: ["child"],
          prompt: null,
          model: null,
          reasoningEffort: null,
          agents: [{ threadId: "child", status: "running", message: "Inspecting renderer" }],
        },
      ],
      disclosures: emptyDisclosures(),
      forkActionsItemId: null,
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
    });

    expect(blocks.map((block) => block.key)).toEqual([
      "item:u1",
      "item:agent-spawn",
      "item:agent-wait",
      "live-agents:turn",
      "live-task:plan-progress-turn",
    ]);
  });

  it("renders agent activity as a one-line summary with consolidated details", () => {
    const block = messageStreamBlocks({
      activeThreadId: "thread",
      turnLifecycle: runningTurnLifecycle("turn"),
      historyCursor: null,
      loadingHistory: false,
      items: [
        {
          id: "agent-1",
          kind: "agent",
          role: "tool",
          text: "Spawn agent",
          turnId: "turn",
          tool: "spawnAgent",
          status: "completed",
          senderThreadId: "parent",
          receiverThreadIds: ["child"],
          prompt: "Inspect the renderer.",
          model: "gpt-5.5",
          reasoningEffort: "high",
          agents: [{ threadId: "child", status: "completed", message: "Done" }],
        },
      ],
      disclosures: emptyDisclosures(),
      forkActionsItemId: null,
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
    })[0];

    const element = renderMessageBlockElement(block);

    expect(element.classList.contains("codex-panel__work-message")).toBe(true);
    expect(element.classList.contains("codex-panel__agent-activity")).toBe(true);
    expect(element.querySelector(".codex-panel__message-role")?.textContent).toBe("agent");
    const summary = expectPresent(element.querySelector<HTMLElement>(".codex-panel__tool-summary"));
    expect(summary.textContent).toBe("spawn child: Inspect the renderer. (completed)");
    expect(summary.classList.contains("codex-panel__agent-activity-summary")).toBe(true);
    expect([...element.querySelectorAll("details summary")].map((detailsSummary) => detailsSummary.textContent)).toEqual(["Details"]);
    expect(element.textContent).toContain("targetchild");
    expect(element.textContent).toContain("PromptInspect the renderer.");
    expect(element.textContent).toContain("childcompleted: Done");
  });

  it("keeps agent activity prompt previews visually constrained to one line", () => {
    const block = messageStreamBlocks({
      activeThreadId: "thread",
      turnLifecycle: runningTurnLifecycle("turn"),
      historyCursor: null,
      loadingHistory: false,
      items: [
        {
          id: "agent-1",
          kind: "agent",
          role: "tool",
          text: "Spawn agent",
          turnId: "turn",
          tool: "spawnAgent",
          status: "running",
          senderThreadId: "parent",
          receiverThreadIds: ["child"],
          prompt: `Inspect the renderer.\n${"a".repeat(180)}`,
          model: null,
          reasoningEffort: null,
          agents: [],
        },
      ],
      disclosures: emptyDisclosures(),
      forkActionsItemId: null,
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
    })[0];

    const element = renderMessageBlockElement(block);
    const summary = expectPresent(element.querySelector<HTMLElement>(".codex-panel__agent-activity-summary"));

    expect(summary.textContent).toBe(`spawn child: Inspect the renderer. ${"a".repeat(73)}... (running)`);
  });

  it("collapses long agent output away from the agent status row", () => {
    const longMessage = `Done\n${"a".repeat(180)}`;
    const threadId = "019e061e-0046-7653-a362-86de9a47cb5c";
    const onDisclosureToggle = vi.fn();
    const block = messageStreamBlocks({
      activeThreadId: "thread",
      turnLifecycle: runningTurnLifecycle("turn"),
      historyCursor: null,
      loadingHistory: false,
      items: [
        {
          id: "agent-1",
          kind: "agent",
          role: "tool",
          text: "Wait for agent",
          turnId: "turn",
          tool: "wait",
          status: "completed",
          senderThreadId: "parent",
          receiverThreadIds: [threadId],
          prompt: null,
          model: null,
          reasoningEffort: null,
          agents: [{ threadId, status: "completed", message: longMessage }],
        },
      ],
      disclosures: emptyDisclosures(),
      forkActionsItemId: null,
      onDisclosureToggle,
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
    })[0];

    const element = renderMessageBlockElement(block);

    expect(element.querySelector(".codex-panel__agent-thread")?.textContent).toBe("019e061e");
    expect(element.querySelector(".codex-panel__agent-status")?.textContent).toBe("completed: Done");
    expect(element.querySelector(".codex-panel__agent-status")?.textContent).not.toContain("a".repeat(180));
    expect([...element.querySelectorAll("details summary")].map((summary) => summary.textContent)).toEqual(["Details"]);
    expect(element.querySelector<HTMLElement>("details summary")?.tabIndex).toBe(-1);
    expect(element.textContent).toContain("Agent output 019e061e");
    expect(element.textContent).toContain(longMessage);
    const details = element.querySelector("details");
    expect(details?.hasAttribute("open")).toBe(false);
    details?.dispatchEvent(new Event("toggle"));
    expect(onDisclosureToggle).toHaveBeenCalledWith("agentDetails", "agent-1", false);
  });

  it("renders a compact live agent summary while subagents are running", () => {
    const blocks = messageStreamBlocks({
      activeThreadId: "thread",
      turnLifecycle: runningTurnLifecycle("turn"),
      historyCursor: null,
      loadingHistory: false,
      items: [
        {
          id: "agent-1",
          kind: "agent",
          role: "tool",
          text: "Wait for agent",
          turnId: "turn",
          tool: "wait",
          status: "running",
          senderThreadId: "parent",
          receiverThreadIds: ["done", "running"],
          prompt: null,
          model: null,
          reasoningEffort: null,
          agents: [
            { threadId: "done", status: "completed", message: null },
            { threadId: "running", status: "running", message: "Inspecting renderer" },
          ],
        },
      ],
      disclosures: emptyDisclosures(),
      forkActionsItemId: null,
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
    });

    const summary = renderMessageBlockElement(expectPresent(blocks.at(-1)));

    expect(summary.classList.contains("codex-panel__work-message")).toBe(true);
    expect(summary.classList.contains("codex-panel__agent-summary")).toBe(true);
    expect(summary.textContent).toContain("agents");
    expect(summary.textContent).toContain("Agents 1 running, 1 done");
    expect(summary.textContent).toContain("runningrunning: Inspecting renderer");
    expect(summary.textContent).not.toContain("donecompleted");
  });

  it("renders context compaction as a one-line work item while running and after completion", () => {
    const runningParent = document.createElement("div");
    const item: MessageStreamItem = {
      id: "compact-1",
      kind: "contextCompaction",
      role: "tool",
      turnId: "turn",
    };

    renderMessageStreamBlocksInAct(
      runningParent,
      messageStreamBlocks({
        activeThreadId: "thread",
        turnLifecycle: runningTurnLifecycle("turn"),
        historyCursor: null,
        loadingHistory: false,
        items: [item],
        disclosures: emptyDisclosures(),
        forkActionsItemId: null,
        loadOlderTurns: vi.fn(),
        renderMarkdown: (element, text) => element.createDiv({ text }),
      }),
    );

    const running = expectPresent(
      runningParent.querySelector<HTMLElement>('[data-codex-panel-block-key="item:compact-1"] .codex-panel__context-compaction'),
    );
    expect(running.querySelector(".codex-panel__message-role")?.textContent).toBe("context");
    expect(running.querySelector(".codex-panel__tool-summary")?.textContent).toBe("Compacting context...");
    expect(running.classList.contains("codex-panel__execution--running")).toBe(true);
    unmountUiRootInAct(runningParent);

    const completedParent = document.createElement("div");
    renderMessageStreamBlocksInAct(
      completedParent,
      messageStreamBlocks({
        activeThreadId: "thread",
        turnLifecycle: idleTurnLifecycle(),
        historyCursor: null,
        loadingHistory: false,
        items: [item],
        disclosures: emptyDisclosures(),
        forkActionsItemId: null,
        loadOlderTurns: vi.fn(),
        renderMarkdown: (element, text) => element.createDiv({ text }),
      }),
    );

    const completed = expectPresent(
      completedParent.querySelector<HTMLElement>('[data-codex-panel-block-key="item:compact-1"] .codex-panel__context-compaction'),
    );
    expect(completed.querySelector(".codex-panel__tool-summary")?.textContent).toBe("Context compacted");
    expect(completed.classList.contains("codex-panel__execution--completed")).toBe(true);
    unmountUiRootInAct(completedParent);
  });

  it("hides the live agent summary once all subagents are complete", () => {
    const blocks = messageStreamBlocks({
      activeThreadId: "thread",
      turnLifecycle: runningTurnLifecycle("turn"),
      historyCursor: null,
      loadingHistory: false,
      items: [
        {
          id: "agent-1",
          kind: "agent",
          role: "tool",
          text: "Wait for agent",
          turnId: "turn",
          tool: "wait",
          status: "completed",
          senderThreadId: "parent",
          receiverThreadIds: ["done"],
          prompt: null,
          model: null,
          reasoningEffort: null,
          agents: [{ threadId: "done", status: "completed", message: null }],
        },
      ],
      disclosures: emptyDisclosures(),
      forkActionsItemId: null,
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
    });

    expect(blocks.some((block) => block.key.startsWith("live-agents:"))).toBe(false);
  });

  it("marks the live agent summary failed when any subagent fails", () => {
    const blocks = messageStreamBlocks({
      activeThreadId: "thread",
      turnLifecycle: runningTurnLifecycle("turn"),
      historyCursor: null,
      loadingHistory: false,
      items: [
        {
          id: "agent-1",
          kind: "agent",
          role: "tool",
          text: "Wait for agent",
          turnId: "turn",
          tool: "wait",
          status: "completed",
          senderThreadId: "parent",
          receiverThreadIds: ["failed", "running"],
          prompt: null,
          model: null,
          reasoningEffort: null,
          agents: [
            { threadId: "failed", status: "errored", message: "Failed" },
            { threadId: "running", status: "running", message: null },
          ],
        },
      ],
      disclosures: emptyDisclosures(),
      forkActionsItemId: null,
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
    });

    const summary = renderMessageBlockElement(expectPresent(blocks.at(-1)));

    expect(summary.classList.contains("codex-panel__execution--failed")).toBe(true);
    expect(summary.textContent).toContain("Agents 1 failed, 1 running");
    expect(summary.textContent).toContain("runningrunning");
    expect(summary.textContent).not.toContain("failederrored: Failed");
  });
});
