// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import type { ThreadStreamItem } from "../../../../../src/features/chat/domain/thread-stream/items";
import { textContents, topLevelDetailsSummaries } from "../../../../support/dom";
import "./setup";
import {
  expectPresent,
  renderThreadStreamBlockElement,
  renderThreadStreamBlocksInAct,
  runningTurnLifecycle,
  testDisclosures,
  threadStreamBlocks,
  unmountUiRootInAct,
} from "./test-helpers";

describe("thread stream item renderer decisions", () => {
  it("renders generic tool details as visible sections inside one details block", () => {
    const block = threadStreamBlocks({
      turnLifecycle: runningTurnLifecycle("turn"),
      items: [
        {
          id: "tool-1",
          kind: "tool",
          role: "tool",
          text: "123",
          toolName: "github.pull_request_read",
          turnId: "turn",
          status: "completed",
          diagnostics: [
            { title: "Arguments JSON", body: '{\n  "id": 123\n}' },
            { title: "Result JSON", body: '{\n  "ok": true\n}' },
          ],
        },
      ],
    })[0];

    const element = renderThreadStreamBlockElement(block);

    expect(element.querySelector(".codex-panel__stream-summary")?.textContent).toBe("123");
    expect(topLevelDetailsSummaries(element)).toEqual(["github.pull_request_read"]);
    expect(textContents(element, "details summary")).toEqual(["github.pull_request_read"]);
    expect(element.querySelector<HTMLElement>("details summary")?.tabIndex).toBe(-1);
    expect(element.textContent).not.toContain("Details");
    expect(textContents(element, ".codex-panel__output-title")).toEqual(["Arguments JSON", "Result JSON"]);
  });

  it("renders steering activity as a compact two-line tool summary", () => {
    const block = threadStreamBlocks({
      items: [
        { id: "u1", kind: "dialogue", dialogueKind: "user", role: "user", text: "do it", turnId: "turn" },
        {
          id: "u2",
          kind: "dialogue",
          dialogueKind: "user",
          role: "user",
          text: "also check tests and keep the summary compact",
          turnId: "turn",
        },
        {
          id: "a1",
          kind: "dialogue",
          role: "assistant",
          text: "done",
          dialogueKind: "assistantResponse",
          dialogueState: "completed",
          turnId: "turn",
        },
      ],
      disclosures: testDisclosures({ activityGroups: ["turn"] }),
    }).find((item) => item.key === "activity:turn-turn-activity");

    const element = renderThreadStreamBlockElement(expectPresent(block));

    expect(element.querySelector(".codex-panel__detail-header")?.textContent).toBe("steering");
    expect(element.querySelector(".codex-panel__stream-summary")?.textContent).toBe("also check tests and keep the summary compact");
  });

  it("renders path summary tools relative to the workspace root", () => {
    const block = threadStreamBlocks({
      turnLifecycle: runningTurnLifecycle("turn"),
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
    })[0];

    const element = renderThreadStreamBlockElement(block);

    expect(element.querySelector(".codex-panel__stream-summary")?.textContent).toBe("assets/image.png");
    expect(element.querySelector(".codex-panel__stream-summary")?.getAttribute("title")).toBeNull();
  });

  it("derives generic tool summaries from primary targets instead of item text", () => {
    const block = threadStreamBlocks({
      turnLifecycle: runningTurnLifecycle("turn"),
      workspaceRoot: "/vault/project",
      items: [
        {
          id: "tool-1",
          kind: "tool",
          role: "tool",
          text: "fallback text",
          toolName: "web search",
          operation: "search",
          primaryTarget: { kind: "value", value: "codex app-server" },
          turnId: "turn",
        },
      ],
    })[0];

    const element = renderThreadStreamBlockElement(block);

    expect(element.querySelector(".codex-panel__stream-summary")?.textContent).toBe("search: codex app-server");
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
      turnLifecycle: runningTurnLifecycle("turn"),
      items: [item] satisfies ThreadStreamItem[],
    };

    renderThreadStreamBlocksInAct(parent, threadStreamBlocks({ ...baseContext, workspaceRoot: "/vault" }));
    expect(parent.querySelector(".codex-panel__stream-summary")?.textContent).toBe("project/assets/image.png");

    renderThreadStreamBlocksInAct(parent, threadStreamBlocks({ ...baseContext, workspaceRoot: "/vault/project" }));
    expect(parent.querySelector(".codex-panel__stream-summary")?.textContent).toBe("assets/image.png");
    unmountUiRootInAct(parent);
  });

  it("keeps path summary tools absolute outside the workspace root", () => {
    const block = threadStreamBlocks({
      turnLifecycle: runningTurnLifecycle("turn"),
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
    })[0];

    const element = renderThreadStreamBlockElement(block);

    expect(element.querySelector(".codex-panel__stream-summary")?.textContent).toBe("/tmp/image.png");
  });

  it("does not treat generic tool summaries as paths without an explicit marker", () => {
    const block = threadStreamBlocks({
      turnLifecycle: runningTurnLifecycle("turn"),
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
    })[0];

    const element = renderThreadStreamBlockElement(block);

    expect(element.querySelector(".codex-panel__stream-summary")?.textContent).toBe("/vault/project");
  });

  it("renders hook metadata as rows inside one details block", () => {
    const block = threadStreamBlocks({
      turnLifecycle: runningTurnLifecycle("turn"),
      items: [
        {
          id: "hook-1",
          kind: "hook",
          role: "tool",
          text: "postToolUse: Formatted 1 file.",
          toolName: "hook",
          turnId: "turn",
          status: "completed",
          executionState: "completed",
          hookRun: {
            eventName: "postToolUse",
            statusMessage: "Formatted 1 file.",
            durationMs: "1ms",
            entries: [{ kind: "feedback", text: "ok" }],
          },
        },
      ],
    })[0];

    const element = renderThreadStreamBlockElement(block);

    expect(topLevelDetailsSummaries(element)).toEqual(["hook"]);
    expect(element.classList.contains("codex-panel__execution--completed")).toBe(true);
    expect(textContents(element, "details summary")).toEqual(["hook"]);
    expect(element.querySelector(".codex-panel__stream-summary")?.textContent).toBe("postToolUse: Formatted 1 file.");
    expect(element.textContent).not.toContain("Details");
    expect(element.querySelector(".codex-panel__meta-grid")?.textContent).toContain("statuscompleted");
    expect(element.querySelector(".codex-panel__meta-grid")?.textContent).toContain("eventpostToolUse");
    expect(element.querySelector(".codex-panel__meta-grid")?.textContent).toContain("messageFormatted 1 file.");
    expect(textContents(element, ".codex-panel__output-title")).toEqual(["Hook output"]);
    expect(element.querySelector(".codex-panel__output pre")?.textContent).toBe("feedback: ok");
  });

  it("renders hook metadata when the hook is inside a completed-turn activity group", () => {
    const blocks = threadStreamBlocks({
      items: [
        { id: "u1", kind: "dialogue", dialogueKind: "user", role: "user", text: "do it", turnId: "turn" },
        {
          id: "hook-1",
          kind: "hook",
          role: "tool",
          text: "postToolUse: Formatted 1 file.",
          toolName: "hook",
          turnId: "turn",
          status: "completed",
          executionState: "completed",
          hookRun: {
            eventName: "postToolUse",
            statusMessage: "Formatted 1 file.",
            entries: [{ kind: "feedback", text: "ok" }],
          },
        },
        {
          id: "a1",
          kind: "dialogue",
          role: "assistant",
          text: "done",
          turnId: "turn",
          dialogueKind: "assistantResponse",
          dialogueState: "completed",
        },
      ],
      disclosures: testDisclosures({ activityGroups: ["turn"], details: ["hook-1:details"] }),
    });

    const element = renderThreadStreamBlockElement(expectPresent(blocks.find((block) => block.key === "activity:turn-turn-activity")));

    expect(element).toBeDefined();
    expect(element.querySelector(":scope > summary")?.textContent).toBe("Work details");
    expect(element.querySelector(".codex-panel__detail-item")?.classList.contains("codex-panel__execution--completed")).toBe(true);
    expect(element.querySelector(".codex-panel__stream-summary")?.textContent).toBe("postToolUse: Formatted 1 file.");
    expect(element.querySelector(".codex-panel__meta-grid")?.textContent).toContain("statuscompleted");
    expect(element.querySelector(".codex-panel__meta-grid")?.textContent).toContain("eventpostToolUse");
    expect(element.querySelector(".codex-panel__output-title")?.textContent).toBe("Hook output");
    expect(element.querySelector(".codex-panel__output pre")?.textContent).toBe("feedback: ok");
  });

  it("renders task progress items as a dedicated task list", () => {
    const block = threadStreamBlocks({
      turnLifecycle: runningTurnLifecycle("turn"),
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
    })[0];

    const element = renderThreadStreamBlockElement(block);

    expect(element.classList.contains("codex-panel__status-stream-item")).toBe(true);
    expect(element.classList.contains("codex-panel__task-progress")).toBe(true);
    expect(element.querySelector(".codex-panel__stream-item-role")?.textContent).toBe("tasks");
    expect(element.textContent).toContain("[x]Inspect code");
    expect(element.textContent).toContain("[>]Patch UI");
  });

  it("renders agent activity as a one-line summary with consolidated details", () => {
    const block = threadStreamBlocks({
      turnLifecycle: runningTurnLifecycle("turn"),
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
          agents: [{ threadId: "child", status: "completed", executionState: "completed", message: "Done" }],
        },
      ],
    })[0];

    const element = renderThreadStreamBlockElement(block);

    expect(element.classList.contains("codex-panel__detail")).toBe(true);
    expect(element.classList.contains("codex-panel__agent-activity")).toBe(true);
    expect(element.querySelector(".codex-panel__stream-item-role")?.textContent).toBe("agent");
    const summary = expectPresent(element.querySelector<HTMLElement>(".codex-panel__stream-summary"));
    expect(summary.textContent).toBe("spawn child: Inspect the renderer. (completed)");
    expect(textContents(element, "details summary")).toEqual(["agent"]);
    expect(element.textContent).toContain("targetchild");
    expect(element.textContent).toContain("PromptInspect the renderer.");
    expect(element.textContent).toContain("childcompleted: Done");
  });

  it("opens agent threads from agent activity headers", () => {
    const openThreadInNewView = vi.fn();
    const block = threadStreamBlocks({
      turnLifecycle: runningTurnLifecycle("turn"),
      openThreadInNewView,
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
          model: null,
          reasoningEffort: null,
          agents: [{ threadId: "child", status: "completed", executionState: "completed", message: "Done" }],
        },
      ],
    })[0];

    const element = renderThreadStreamBlockElement(block);
    const header = expectPresent(element.querySelector<HTMLElement>("details summary"));
    const open = expectPresent(header.querySelector<HTMLButtonElement>('[aria-label="Open agent thread"]'));

    expect(textContents(element, "details summary")).toEqual(["agent"]);
    open.click();

    expect(openThreadInNewView).toHaveBeenCalledWith("child");
  });

  it("keeps agent activity headers passive without an open thread handler", () => {
    const block = threadStreamBlocks({
      turnLifecycle: runningTurnLifecycle("turn"),
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
          model: null,
          reasoningEffort: null,
          agents: [{ threadId: "child", status: "completed", executionState: "completed", message: "Done" }],
        },
      ],
    })[0];

    const element = renderThreadStreamBlockElement(block);

    expect(element.querySelector<HTMLButtonElement>('[aria-label="Open agent thread"]')).toBeNull();
  });

  it("keeps agent thread actions available after agent details expand", () => {
    const openThreadInNewView = vi.fn();
    const block = threadStreamBlocks({
      turnLifecycle: runningTurnLifecycle("turn"),
      openThreadInNewView,
      disclosures: testDisclosures({ details: ["agent-1:agent-details"] }),
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
          receiverThreadIds: ["child"],
          prompt: null,
          model: null,
          reasoningEffort: null,
          agents: [{ threadId: "child", status: "completed", executionState: "completed", message: "Done" }],
        },
      ],
    })[0];

    const element = renderThreadStreamBlockElement(block);
    expect(element.querySelector("details")?.hasAttribute("open")).toBe(true);

    expectPresent(element.querySelector<HTMLButtonElement>("details summary [aria-label='Open agent thread']")).click();

    expect(openThreadInNewView).toHaveBeenCalledWith("child");
  });

  it("keeps agent activity prompt previews visually constrained to one line", () => {
    const block = threadStreamBlocks({
      turnLifecycle: runningTurnLifecycle("turn"),
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
    })[0];

    const element = renderThreadStreamBlockElement(block);
    const summary = expectPresent(element.querySelector<HTMLElement>(".codex-panel__stream-summary"));

    expect(summary.textContent).toBe(`spawn child: Inspect the renderer. ${"a".repeat(73)}... (running)`);
  });

  it("collapses long agent output away from the agent status row", () => {
    const longMessage = `Done\n${"a".repeat(180)}`;
    const threadId = "019e061e-0046-7653-a362-86de9a47cb5c";
    const onDisclosureToggle = vi.fn();
    const block = threadStreamBlocks({
      turnLifecycle: runningTurnLifecycle("turn"),
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
          agents: [{ threadId, status: "completed", executionState: "completed", message: longMessage }],
        },
      ],
      onDisclosureToggle,
    })[0];

    const element = renderThreadStreamBlockElement(block);

    const agentRows = textContents(element, ".codex-panel__meta-grid dt, .codex-panel__meta-grid dd");
    expect(agentRows).toContain("019e061e");
    expect(agentRows).toContain("completed: Done");
    expect(agentRows.join("")).not.toContain("a".repeat(180));
    expect(textContents(element, "details summary")).toEqual(["agent"]);
    expect(element.querySelector<HTMLElement>("details summary")?.tabIndex).toBe(-1);
    expect(element.textContent).toContain("Agent output 019e061e");
    expect(element.textContent).toContain(longMessage);
    const details = element.querySelector("details");
    expect(details?.hasAttribute("open")).toBe(false);
    details?.dispatchEvent(new Event("toggle"));
    expect(onDisclosureToggle).toHaveBeenCalledWith("details", "agent-1:agent-details", false);
  });

  it("renders a compact live agent summary while subagents are running", () => {
    const openThreadInNewView = vi.fn();
    const blocks = threadStreamBlocks({
      turnLifecycle: runningTurnLifecycle("turn"),
      openThreadInNewView,
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
            { threadId: "done", status: "completed", executionState: "completed", message: null },
            { threadId: "running", status: "running", executionState: "running", message: "Inspecting renderer" },
          ],
        },
      ],
    });

    const summary = renderThreadStreamBlockElement(expectPresent(blocks.at(-1)));

    expect(summary.classList.contains("codex-panel__status-stream-item")).toBe(true);
    expect(summary.classList.contains("codex-panel__agent-summary")).toBe(true);
    expect(summary.textContent).toContain("agents");
    expect(summary.textContent).toContain("Agents 1 running, 1 done");
    expect(summary.textContent).toContain("runningInspecting renderer");
    expect(summary.textContent).not.toContain("donecompleted");
    expect(summary.querySelector<HTMLButtonElement>('[aria-label="Open agent thread"]')).toBeNull();
    const open = expectPresent(summary.querySelector<HTMLElement>(".codex-panel__agent-row--interactive"));
    expect(open.textContent).toBe("runningInspecting renderer");
    open.click();
    expect(openThreadInNewView).toHaveBeenCalledWith("running");
  });

  it("renders context compaction as a one-line status item while running and after completion", () => {
    const runningParent = document.createElement("div");
    const item: ThreadStreamItem = {
      id: "compact-1",
      kind: "contextCompaction",
      role: "tool",
      turnId: "turn",
    };

    renderThreadStreamBlocksInAct(
      runningParent,
      threadStreamBlocks({
        turnLifecycle: runningTurnLifecycle("turn"),
        items: [item],
        renderMarkdown: (element, text) => element.createDiv({ text }),
      }),
    );

    const running = expectPresent(
      runningParent.querySelector<HTMLElement>('[data-codex-panel-block-key="item:compact-1"] .codex-panel__context-compaction'),
    );
    expect(running.querySelector(".codex-panel__stream-item-role")?.textContent).toBe("context");
    expect(running.querySelector(".codex-panel__stream-summary")?.textContent).toBe("Compacting context...");
    expect(running.classList.contains("codex-panel__execution--running")).toBe(true);
    unmountUiRootInAct(runningParent);

    const completedParent = document.createElement("div");
    renderThreadStreamBlocksInAct(
      completedParent,
      threadStreamBlocks({
        items: [item],
        renderMarkdown: (element, text) => element.createDiv({ text }),
      }),
    );

    const completed = expectPresent(
      completedParent.querySelector<HTMLElement>('[data-codex-panel-block-key="item:compact-1"] .codex-panel__context-compaction'),
    );
    expect(completed.querySelector(".codex-panel__stream-summary")?.textContent).toBe("Context compacted");
    expect(completed.classList.contains("codex-panel__execution--completed")).toBe(true);
    unmountUiRootInAct(completedParent);
  });

  it("hides the live agent summary once all subagents are complete", () => {
    const blocks = threadStreamBlocks({
      turnLifecycle: runningTurnLifecycle("turn"),
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
          agents: [{ threadId: "done", status: "completed", executionState: "completed", message: null }],
        },
      ],
    });

    expect(blocks.some((block) => block.key.startsWith("live-agents:"))).toBe(false);
  });

  it("marks the live agent summary failed when any subagent fails", () => {
    const blocks = threadStreamBlocks({
      turnLifecycle: runningTurnLifecycle("turn"),
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
            { threadId: "failed", status: "errored", executionState: "failed", message: "Failed" },
            { threadId: "running", status: "running", executionState: "running", message: null },
          ],
        },
      ],
    });

    const summary = renderThreadStreamBlockElement(expectPresent(blocks.at(-1)));

    expect(summary.classList.contains("codex-panel__execution--failed")).toBe(true);
    expect(summary.textContent).toContain("Agents 1 failed, 1 running");
    expect(summary.textContent).toContain("runningrunning");
    expect(summary.textContent).not.toContain("failederrored: Failed");
  });
});
