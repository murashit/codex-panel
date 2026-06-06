// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { act } from "preact/test-utils";

import type { DisplayItem } from "../../../../../src/features/chat/display/types";
import { topLevelDetailsSummaries } from "../../../../support/dom";
import "./setup";
import {
  expectPresent,
  idleTurnLifecycle,
  messageStreamBlocks,
  renderMessageBlockElement,
  renderMessageStreamBlocksInAct,
  runningTurnLifecycle,
  unmountUiRootInAct,
} from "./test-helpers";

describe("work log renderer decisions", () => {
  it("renders generic tool details as visible sections inside one details block", () => {
    const block = messageStreamBlocks({
      activeThreadId: "thread",
      turnLifecycle: runningTurnLifecycle("turn"),
      historyCursor: null,
      loadingHistory: false,
      displayItems: [
        {
          id: "tool-1",
          kind: "tool",
          role: "tool",
          text: "123",
          toolLabel: "github.pull_request_read",
          turnId: "turn",
          status: "completed",
          details: [
            { title: "Arguments JSON", body: '{\n  "id": 123\n}' },
            { title: "Result JSON", body: '{\n  "ok": true\n}' },
          ],
        },
      ],
      openDetails: new Set(),
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

  it("keeps the tool summary as a separate row when details are open", () => {
    const block = messageStreamBlocks({
      activeThreadId: "thread",
      turnLifecycle: runningTurnLifecycle("turn"),
      historyCursor: null,
      loadingHistory: false,
      displayItems: [
        {
          id: "cmd-1",
          kind: "command",
          role: "tool",
          text: "npm run check",
          turnId: "turn",
          command: "npm run check",
          cwd: "/vault",
          status: "completed",
          exitCode: 0,
          output: "ok",
        },
      ],
      openDetails: new Set(["cmd-1:command-details"]),
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
    })[0];

    const element = renderMessageBlockElement(block);

    expect(element.classList.contains("is-open")).toBe(true);
    expect(element.querySelector("details")?.hasAttribute("open")).toBe(true);
    expect(topLevelDetailsSummaries(element)).toEqual(["command"]);
    expect(element.querySelector(":scope > .codex-panel__tool-summary")?.textContent).toBe("npm run check");
  });

  it("renders generic tools without details as two compact rows", () => {
    const block = messageStreamBlocks({
      activeThreadId: "thread",
      turnLifecycle: runningTurnLifecycle("turn"),
      historyCursor: null,
      loadingHistory: false,
      displayItems: [
        {
          id: "tool-plain",
          kind: "tool",
          role: "tool",
          text: "https://example.com",
          toolLabel: "web search",
          turnId: "turn",
        },
      ],
      openDetails: new Set(),
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
    })[0];

    const element = renderMessageBlockElement(block);

    expect(element.classList.contains("codex-panel__tool-result--plain")).toBe(true);
    expect(element.querySelector(".codex-panel__tool-result-header")?.textContent).toBe("web search");
    expect(element.querySelector(".codex-panel__tool-summary")?.textContent).toBe("https://example.com");
  });

  it("renders plain tools without a summary as a single compact row", () => {
    const block = messageStreamBlocks({
      activeThreadId: "thread",
      turnLifecycle: runningTurnLifecycle("turn"),
      historyCursor: null,
      loadingHistory: false,
      displayItems: [
        {
          id: "tool-event",
          kind: "tool",
          role: "tool",
          text: "",
          toolLabel: "user steered",
          turnId: "turn",
        },
      ],
      openDetails: new Set(),
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
    })[0];

    const element = renderMessageBlockElement(block);

    expect(element.classList.contains("codex-panel__tool-result--plain")).toBe(true);
    expect(element.querySelector(".codex-panel__tool-result-header")?.textContent).toBe("user steered");
    expect(element.querySelector(".codex-panel__tool-summary")).toBeNull();
    expect(element.textContent).toBe("user steered");
  });

  it("renders steering activity as a compact two-line tool summary", () => {
    const block = messageStreamBlocks({
      activeThreadId: "thread",
      turnLifecycle: idleTurnLifecycle(),
      historyCursor: null,
      loadingHistory: false,
      displayItems: [
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
      openDetails: new Set(["turn:turn:activity"]),
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
      displayItems: [
        {
          id: "tool-path",
          kind: "tool",
          role: "tool",
          text: "/vault/project/assets/image.png",
          toolLabel: "imageView",
          summaryPath: true,
          turnId: "turn",
        },
      ],
      openDetails: new Set(),
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
    })[0];

    const element = renderMessageBlockElement(block);

    expect(element.querySelector(".codex-panel__tool-summary")?.textContent).toBe("assets/image.png");
    expect(element.querySelector(".codex-panel__tool-summary")?.getAttribute("title")).toBeNull();
  });

  it("updates path summary tools when the workspace root changes", () => {
    const parent = document.createElement("div");
    const item = {
      id: "tool-path",
      kind: "tool",
      role: "tool",
      text: "/vault/project/assets/image.png",
      toolLabel: "imageView",
      summaryPath: true,
      turnId: "turn",
    } as const;
    const baseContext = {
      activeThreadId: "thread",
      turnLifecycle: runningTurnLifecycle("turn"),
      historyCursor: null,
      loadingHistory: false,
      displayItems: [item] satisfies DisplayItem[],
      openDetails: new Set<string>(),
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
      displayItems: [
        {
          id: "tool-path",
          kind: "tool",
          role: "tool",
          text: "/tmp/image.png",
          toolLabel: "imageView",
          summaryPath: true,
          turnId: "turn",
        },
      ],
      openDetails: new Set(),
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
      displayItems: [
        {
          id: "tool-path-like",
          kind: "tool",
          role: "tool",
          text: "/vault/project",
          toolLabel: "example.tool",
          turnId: "turn",
        },
      ],
      openDetails: new Set(),
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
      displayItems: [
        {
          id: "hook-1",
          kind: "hook",
          role: "tool",
          text: "postToolUse: Formatted 1 file.",
          toolLabel: "hook",
          turnId: "turn",
          status: "completed",
          details: [
            {
              rows: [
                { key: "status", value: "completed" },
                { key: "event", value: "postToolUse" },
                { key: "message", value: "Formatted 1 file." },
                { key: "duration", value: "1ms" },
              ],
            },
            { title: "Hook output", body: "feedback: ok" },
          ],
        },
      ],
      openDetails: new Set(),
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
      displayItems: [
        { id: "u1", kind: "message", messageKind: "user", role: "user", text: "do it", turnId: "turn" },
        {
          id: "hook-1",
          kind: "hook",
          role: "tool",
          text: "postToolUse: Formatted 1 file.",
          toolLabel: "hook",
          turnId: "turn",
          status: "completed",
          details: [
            {
              rows: [
                { key: "status", value: "completed" },
                { key: "event", value: "postToolUse" },
                { key: "message", value: "Formatted 1 file." },
              ],
            },
            { title: "Hook output", body: "feedback: ok" },
          ],
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
      openDetails: new Set(["turn:turn:activity", "hook-1"]),
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

  it("keeps completed-turn activity group items mounted through Preact", () => {
    const parent = document.createElement("div");
    const onDetailsToggle = vi.fn();

    renderMessageStreamBlocksInAct(
      parent,
      messageStreamBlocks({
        activeThreadId: "thread",
        turnLifecycle: idleTurnLifecycle(),
        historyCursor: null,
        loadingHistory: false,
        displayItems: [
          { id: "u1", kind: "message", messageKind: "user", role: "user", text: "do it", turnId: "turn" },
          {
            id: "hook-1",
            kind: "hook",
            role: "tool",
            text: "postToolUse: Formatted 1 file.",
            toolLabel: "hook",
            turnId: "turn",
            status: "completed",
            details: [
              {
                rows: [
                  { key: "status", value: "completed" },
                  { key: "event", value: "postToolUse" },
                ],
              },
              { title: "Hook output", body: "feedback: ok" },
            ],
          },
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
            prompt: null,
            model: null,
            reasoningEffort: null,
            agents: [{ threadId: "child", status: "completed", message: "Done" }],
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
        openDetails: new Set(["turn:turn:activity", "hook-1:details"]),
        onDetailsToggle,
        loadOlderTurns: vi.fn(),
        renderMarkdown: (element, text) => element.createDiv({ text }),
      }),
    );

    const group = expectPresent(parent.querySelector<HTMLElement>('[data-codex-panel-block-key="activity:turn-turn-activity"]'));
    expect(group.querySelector(":scope > .codex-panel__activity-group > summary")?.textContent).toBe("Work details: agent, hook");
    expect(group.querySelector(".codex-panel__tool-result .codex-panel__tool-result-header")?.textContent).toBe("hook");
    expect(group.querySelector(".codex-panel__tool-result > .codex-panel__tool-summary")?.textContent).toBe(
      "postToolUse: Formatted 1 file.",
    );
    expect(group.querySelector(".codex-panel__agent-activity .codex-panel__tool-summary")?.textContent).toBe("spawn child (completed)");

    const details = expectPresent(group.querySelector<HTMLDetailsElement>(".codex-panel__activity-group"));
    void act(() => {
      details.open = false;
      details.dispatchEvent(new Event("toggle", { bubbles: false }));
    });

    expect(onDetailsToggle).toHaveBeenCalledWith("turn:turn:activity", false);
    unmountUiRootInAct(parent);
  });

  it("renders task progress items as a dedicated task list", () => {
    const block = messageStreamBlocks({
      activeThreadId: "thread",
      turnLifecycle: runningTurnLifecycle("turn"),
      historyCursor: null,
      loadingHistory: false,
      displayItems: [
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
      openDetails: new Set(),
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

  it("keeps task progress Preact items mounted in the message stream host", () => {
    const parent = document.createElement("div");

    renderMessageStreamBlocksInAct(
      parent,
      messageStreamBlocks({
        activeThreadId: "thread",
        turnLifecycle: runningTurnLifecycle("turn"),
        historyCursor: null,
        loadingHistory: false,
        displayItems: [
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
        openDetails: new Set(),
        loadOlderTurns: vi.fn(),
        renderMarkdown: (element, text) => element.createDiv({ text }),
      }),
    );

    const block = expectPresent(parent.querySelector<HTMLElement>('[data-codex-panel-block-key="live-task:plan-progress-turn"]'));
    expect(block.querySelector(".codex-panel__task-progress .codex-panel__message-role")?.textContent).toBe("tasks");
    expect(block.textContent).toContain("[x]Inspect code");
    expect(block.textContent).toContain("[>]Patch UI");
    unmountUiRootInAct(parent);
  });

  it("renders active task progress with the shared bottom live blocks", () => {
    const blocks = messageStreamBlocks({
      activeThreadId: "thread",
      turnLifecycle: runningTurnLifecycle("turn"),
      historyCursor: null,
      loadingHistory: false,
      displayItems: [
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
      openDetails: new Set(),
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
      pendingRequestsSignature: "request:1",
      renderPendingRequests: () => "Request",
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
      displayItems: [
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
      openDetails: new Set(),
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
      displayItems: [
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
      openDetails: new Set(),
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
      displayItems: [
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
      openDetails: new Set(),
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

  it("keeps agent Preact details mounted in the message stream host", () => {
    const parent = document.createElement("div");
    const onDetailsToggle = vi.fn();

    renderMessageStreamBlocksInAct(
      parent,
      messageStreamBlocks({
        activeThreadId: "thread",
        turnLifecycle: runningTurnLifecycle("turn"),
        historyCursor: null,
        loadingHistory: false,
        displayItems: [
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
        openDetails: new Set(),
        onDetailsToggle,
        loadOlderTurns: vi.fn(),
        renderMarkdown: (element, text) => element.createDiv({ text }),
      }),
    );

    const block = expectPresent(parent.querySelector<HTMLElement>('[data-codex-panel-block-key="item:agent-1"]'));
    expect(block.querySelector(".codex-panel__agent-activity .codex-panel__message-role")?.textContent).toBe("agent");
    expect(block.querySelector(".codex-panel__tool-summary")?.textContent).toBe("spawn child: Inspect the renderer. (completed)");
    expect([...block.querySelectorAll("details summary")].map((summary) => summary.textContent)).toEqual(["Details"]);

    const details = expectPresent(block.querySelector<HTMLDetailsElement>("details"));
    void act(() => {
      details.open = true;
      details.dispatchEvent(new Event("toggle", { bubbles: false }));
    });

    expect(onDetailsToggle).toHaveBeenCalledWith("agent-1:agent-details", true);
    expect(expectPresent(block.querySelector(".codex-panel__agent-activity")).classList.contains("is-open")).toBe(true);
    unmountUiRootInAct(parent);
  });

  it("keeps agent activity prompt previews visually constrained to one line", () => {
    const block = messageStreamBlocks({
      activeThreadId: "thread",
      turnLifecycle: runningTurnLifecycle("turn"),
      historyCursor: null,
      loadingHistory: false,
      displayItems: [
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
      openDetails: new Set(),
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
    const onDetailsToggle = vi.fn();
    const block = messageStreamBlocks({
      activeThreadId: "thread",
      turnLifecycle: runningTurnLifecycle("turn"),
      historyCursor: null,
      loadingHistory: false,
      displayItems: [
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
      openDetails: new Set(),
      onDetailsToggle,
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
    expect(onDetailsToggle).toHaveBeenCalled();
  });

  it("renders a compact live agent summary while subagents are running", () => {
    const blocks = messageStreamBlocks({
      activeThreadId: "thread",
      turnLifecycle: runningTurnLifecycle("turn"),
      historyCursor: null,
      loadingHistory: false,
      displayItems: [
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
      openDetails: new Set(),
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

  it("renders the compact live agent summary as a Preact block", () => {
    const parent = document.createElement("div");

    renderMessageStreamBlocksInAct(
      parent,
      messageStreamBlocks({
        activeThreadId: "thread",
        turnLifecycle: runningTurnLifecycle("turn"),
        historyCursor: null,
        loadingHistory: false,
        displayItems: [
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
        openDetails: new Set(),
        loadOlderTurns: vi.fn(),
        renderMarkdown: (element, text) => element.createDiv({ text }),
      }),
    );

    const summary = expectPresent(parent.querySelector<HTMLElement>('[data-codex-panel-block-key="live-agents:turn"]'));
    expect(summary.querySelector(".codex-panel__agent-summary")?.textContent).toContain("Agents 1 running, 1 done");
    expect(summary.textContent).toContain("runningrunning: Inspecting renderer");
    unmountUiRootInAct(parent);
  });

  it("renders active reasoning as a Preact message stream block", () => {
    const parent = document.createElement("div");

    renderMessageStreamBlocksInAct(
      parent,
      messageStreamBlocks({
        activeThreadId: "thread",
        turnLifecycle: runningTurnLifecycle("turn"),
        historyCursor: null,
        loadingHistory: false,
        displayItems: [{ id: "reasoning-1", kind: "reasoning", role: "tool", text: "", turnId: "turn", status: "running" }],
        openDetails: new Set(),
        loadOlderTurns: vi.fn(),
        renderMarkdown: (element, text) => element.createDiv({ text }),
      }),
    );

    const reasoning = expectPresent(
      parent.querySelector<HTMLElement>('[data-codex-panel-block-key="item:reasoning-1"] .codex-panel__reasoning'),
    );
    expect(reasoning.classList.contains("is-active")).toBe(true);
    expect(reasoning.querySelector(".codex-panel__reasoning-role")?.textContent).toBe("reasoning");
    expect(reasoning.querySelector(".codex-panel__reasoning-content")?.textContent).toBe("Reasoning...");
    unmountUiRootInAct(parent);
  });

  it("renders context compaction as a one-line work item while running and after completion", () => {
    const runningParent = document.createElement("div");
    const item: DisplayItem = { id: "compact-1", kind: "contextCompaction", role: "tool", text: "Context compaction", turnId: "turn" };

    renderMessageStreamBlocksInAct(
      runningParent,
      messageStreamBlocks({
        activeThreadId: "thread",
        turnLifecycle: runningTurnLifecycle("turn"),
        historyCursor: null,
        loadingHistory: false,
        displayItems: [item],
        openDetails: new Set(),
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
        displayItems: [item],
        openDetails: new Set(),
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
      displayItems: [
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
      openDetails: new Set(),
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
      displayItems: [
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
      openDetails: new Set(),
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
