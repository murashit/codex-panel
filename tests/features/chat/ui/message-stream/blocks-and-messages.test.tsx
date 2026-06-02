// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { createElement } from "preact";
import { act } from "preact/test-utils";

import type { DisplayItem } from "../../../../../src/features/chat/display/types";
import { implementPlanCandidateFromState } from "../../../../../src/features/chat/chat-message-renderer";
import { topLevelDetailsSummaries } from "../../../../support/dom";
import "./setup";
import {
  expectPresent,
  idleTurnLifecycle,
  messageStreamBlocks,
  renderMessageBlockElement,
  renderMessageStreamBlocksInAct,
  renderUiRootInAct,
  runningTurnLifecycle,
  startingTurnLifecycle,
  testMessageStreamBlock,
  unmountUiRootInAct,
  withMessageContentScrollHeight,
} from "./test-helpers";

describe("message stream block identity and message actions", () => {
  it("reuses keyed Preact message block hosts across rerenders", () => {
    const parent = document.createElement("div");
    renderMessageStreamBlocksInAct(parent, [testMessageStreamBlock("one", createElement("section", null, "first"))]);

    const host = expectPresent(parent.querySelector<HTMLElement>('[data-codex-panel-block-key="one"]'));
    expect(host.classList.contains("codex-panel__message-block")).toBe(true);
    expect(host.firstElementChild?.tagName).toBe("SECTION");
    expect(host.textContent).toBe("first");

    renderMessageStreamBlocksInAct(parent, [testMessageStreamBlock("one", createElement("section", null, "still first"))]);

    expect(parent.querySelector('[data-codex-panel-block-key="one"]')).toBe(host);
    expect(host.firstElementChild?.tagName).toBe("SECTION");
    expect(host.textContent).toBe("still first");

    renderMessageStreamBlocksInAct(parent, [testMessageStreamBlock("one", createElement("article", null, "replacement"))]);

    expect(parent.querySelector('[data-codex-panel-block-key="one"]')).toBe(host);
    expect(host.firstElementChild?.tagName).toBe("ARTICLE");
    renderMessageStreamBlocksInAct(parent, []);
    expect(parent.querySelector('[data-codex-panel-block-key="one"]')).toBeNull();
    unmountUiRootInAct(parent);
  });

  it("leaves stable ordered Preact message block hosts in place during repeated renders", () => {
    const parent = document.createElement("div");
    renderMessageStreamBlocksInAct(parent, [
      testMessageStreamBlock("one", createElement("section", null, "one")),
      testMessageStreamBlock("two", createElement("article", null, "two")),
    ]);
    const firstHost = expectPresent(parent.querySelector<HTMLElement>('[data-codex-panel-block-key="one"]'));
    const secondHost = expectPresent(parent.querySelector<HTMLElement>('[data-codex-panel-block-key="two"]'));

    const insertBefore = vi.spyOn(parent, "insertBefore");
    renderMessageStreamBlocksInAct(parent, [
      testMessageStreamBlock("one", createElement("section", null, "one again")),
      testMessageStreamBlock("two", createElement("article", null, "two again")),
    ]);

    expect(insertBefore).not.toHaveBeenCalled();
    expect([...parent.children]).toEqual([firstHost, secondHost]);
    expect(firstHost.firstElementChild?.tagName).toBe("SECTION");
    expect(secondHost.firstElementChild?.tagName).toBe("ARTICLE");
    unmountUiRootInAct(parent);
  });

  it("inserts completed-turn activity groups without replacing stable conversation nodes", () => {
    const parent = document.createElement("div");
    const baseContext = {
      activeThreadId: "thread",
      turnLifecycle: idleTurnLifecycle(),
      historyCursor: null,
      loadingHistory: false,
      openDetails: new Set<string>(),
      loadOlderTurns: vi.fn(),
      renderMarkdown: (element: HTMLElement, text: string) => element.createDiv({ text }),
      renderTextWithWikiLinks: (element: HTMLElement, text: string) => element.createDiv({ text }),
    };

    renderMessageStreamBlocksInAct(
      parent,
      messageStreamBlocks({
        ...baseContext,
        displayItems: [
          { id: "u1", kind: "message", role: "user", text: "do it", turnId: "t1", markdown: true },
          { id: "a1", kind: "message", role: "assistant", text: "done", turnId: "t1", markdown: true },
        ],
      }),
    );
    const userNode = parent.querySelector<HTMLElement>('[data-codex-panel-block-key="item:u1"]');
    const assistantNode = parent.querySelector<HTMLElement>('[data-codex-panel-block-key="item:a1"]');

    renderMessageStreamBlocksInAct(
      parent,
      messageStreamBlocks({
        ...baseContext,
        displayItems: [
          { id: "u1", kind: "message", role: "user", text: "do it", turnId: "t1", markdown: true },
          {
            id: "hook-1",
            kind: "hook",
            role: "tool",
            text: "userPromptSubmit: Saving jj baseline",
            toolLabel: "hook",
            turnId: "t1",
            status: "completed",
          },
          { id: "a1", kind: "message", role: "assistant", text: "done", turnId: "t1", markdown: true },
        ],
      }),
    );

    expect(parent.querySelector('[data-codex-panel-block-key="item:u1"]')).toBe(userNode);
    expect(parent.querySelector('[data-codex-panel-block-key="item:a1"]')).toBe(assistantNode);
    expect([...parent.children].map((element) => element.getAttribute("data-codex-panel-block-key"))).toEqual([
      "item:u1",
      "activity:turn-t1-activity",
      "item:a1",
    ]);
    expect(parent.querySelector('[data-codex-panel-block-key="activity:turn-t1-activity"] summary')?.textContent).toBe(
      "Work details: hook",
    );
    unmountUiRootInAct(parent);
  });

  it("renders the history bar as a Preact block", () => {
    const loadOlderTurns = vi.fn();
    const [historyBlock] = messageStreamBlocks({
      activeThreadId: "thread",
      turnLifecycle: idleTurnLifecycle(),
      historyCursor: "cursor",
      loadingHistory: false,
      displayItems: [],
      openDetails: new Set(),
      loadOlderTurns,
      renderMarkdown: (element, text) => element.createDiv({ text }),
      renderTextWithWikiLinks: (element, text) => element.createDiv({ text }),
    });
    const parent = document.createElement("div");

    expect(historyBlock.key).toBe("history-bar");
    expect(historyBlock.node).not.toBeUndefined();
    renderUiRootInAct(parent, historyBlock.node);

    const button = expectPresent(parent.querySelector<HTMLButtonElement>("button"));
    expect(parent.querySelector(".codex-panel__history-bar")).not.toBeNull();
    expect(button.textContent).toBe("Load older");
    expect(button.disabled).toBe(false);

    button.click();

    expect(loadOlderTurns).toHaveBeenCalledOnce();
    unmountUiRootInAct(parent);
  });

  it("renders the empty message stream state as a Preact block", () => {
    const [emptyBlock] = messageStreamBlocks({
      activeThreadId: null,
      turnLifecycle: idleTurnLifecycle(),
      historyCursor: null,
      loadingHistory: false,
      displayItems: [],
      openDetails: new Set(),
      loadOlderTurns: vi.fn(),
      renderMarkdown: (element, text) => element.createDiv({ text }),
      renderTextWithWikiLinks: (element, text) => element.createDiv({ text }),
    });
    const parent = document.createElement("div");

    expect(emptyBlock.key).toBe("empty");
    expect(emptyBlock.node).not.toBeUndefined();
    renderUiRootInAct(parent, emptyBlock.node);

    const empty = expectPresent(parent.querySelector<HTMLElement>(".codex-panel__message--system"));
    expect(empty.classList.contains("codex-panel__message")).toBe(true);
    expect(empty.textContent).toBe("Send a message to start a conversation.");
    unmountUiRootInAct(parent);
  });

  it("renders review result items as compact auto-review tool rows", () => {
    const block = messageStreamBlocks({
      activeThreadId: "thread",
      turnLifecycle: idleTurnLifecycle(),
      historyCursor: null,
      loadingHistory: false,
      displayItems: [{ id: "review-1", kind: "reviewResult", role: "tool", text: "Auto-review denied this command.", markdown: false }],
      openDetails: new Set(),
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
      renderTextWithWikiLinks: (parent, text) => parent.createDiv({ text }),
    })[0];

    const element = renderMessageBlockElement(block);

    expect(element.classList.contains("codex-panel__message--review-result")).toBe(true);
    expect(element.classList.contains("codex-panel__tool-result--plain")).toBe(true);
    expect(element.querySelector(".codex-panel__message-role")?.textContent).toBe("auto-review");
    expect(element.textContent).toContain("Auto-review denied this command.");
    expect(element.querySelector("details")).toBeNull();
  });

  it("renders review result details inside one auto-review details block", () => {
    const block = messageStreamBlocks({
      activeThreadId: "thread",
      turnLifecycle: idleTurnLifecycle(),
      historyCursor: null,
      loadingHistory: false,
      displayItems: [
        {
          id: "review-1",
          kind: "reviewResult",
          role: "tool",
          text: "Auto-review approved: npm test",
          turnId: "turn",
          markdown: false,
          executionState: "completed",
          details: [
            {
              title: "Review",
              rows: [
                { key: "status", value: "approved" },
                { key: "action", value: "apply patch" },
                { key: "files", value: "src/display/tool-view.ts\nsrc/ui/message-stream.ts" },
              ],
            },
          ],
        },
      ],
      openDetails: new Set(),
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
      renderTextWithWikiLinks: (parent, text) => parent.createDiv({ text }),
    })[0];

    const element = renderMessageBlockElement(block);

    expect(element.classList.contains("codex-panel__execution--completed")).toBe(true);
    expect(topLevelDetailsSummaries(element)).toEqual(["auto-review"]);
    expect([...element.querySelectorAll("details summary")].map((summary) => summary.textContent)).toEqual(["auto-review"]);
    expect(element.textContent).not.toContain("Details");
    expect(element.textContent).not.toContain("▶Review");
    expect(element.querySelector(".codex-panel__meta-grid")?.textContent).toContain("statusapproved");
    expect(element.querySelector(".codex-panel__meta-grid")?.textContent).toContain("actionapply patch");
    expect(element.querySelector(".codex-panel__meta-grid")?.textContent).toContain(
      "filessrc/display/tool-view.ts\nsrc/ui/message-stream.ts",
    );
    expect([...element.querySelectorAll(".codex-panel__output-title")].map((title) => title.textContent)).toEqual([]);
  });

  it("keeps tool result Preact details mounted in the message stream host", () => {
    const parent = document.createElement("div");
    const onDetailsToggle = vi.fn();
    const renderTextWithWikiLinks = vi.fn((element: HTMLElement, text: string) => {
      element.createDiv({ text: `linked:${text}` });
    });

    renderMessageStreamBlocksInAct(
      parent,
      messageStreamBlocks({
        activeThreadId: "thread",
        turnLifecycle: idleTurnLifecycle(),
        historyCursor: null,
        loadingHistory: false,
        displayItems: [
          {
            id: "cmd-1",
            kind: "command",
            role: "tool",
            text: "npm test",
            command: "npm test",
            cwd: "/vault",
            status: "completed",
            output: "ok",
            executionState: "completed",
          },
        ],
        openDetails: new Set(),
        onDetailsToggle,
        loadOlderTurns: vi.fn(),
        renderMarkdown: (element, text) => element.createDiv({ text }),
        renderTextWithWikiLinks,
      }),
    );

    const block = expectPresent(parent.querySelector<HTMLElement>('[data-codex-panel-block-key="item:cmd-1"]'));
    const result = expectPresent(block.querySelector<HTMLElement>(".codex-panel__tool-result"));
    expect(result.classList.contains("codex-panel__execution--completed")).toBe(true);
    expect(result.querySelector(".codex-panel__tool-result-header")?.textContent).toBe("command");
    expect(result.querySelector(":scope > .codex-panel__tool-summary")?.textContent).toBe("linked:npm test");
    expect(result.querySelector(".codex-panel__tool-summary")?.textContent).toBe("linked:npm test");
    expect(result.querySelector(".codex-panel__meta-grid")?.textContent).toContain("commandnpm test");
    expect(result.querySelector(".codex-panel__output-title")?.textContent).toBe("Output");
    expect(renderTextWithWikiLinks).toHaveBeenCalledWith(expect.any(HTMLElement), "npm test");

    const details = expectPresent(result.querySelector<HTMLDetailsElement>("details"));
    void act(() => {
      details.open = true;
      details.dispatchEvent(new Event("toggle", { bubbles: false }));
    });

    expect(onDetailsToggle).toHaveBeenCalledWith("cmd-1:command-details", true);
    unmountUiRootInAct(parent);
  });

  it("renders file change diffs through the Preact tool result adapter", () => {
    const parent = document.createElement("div");

    renderMessageStreamBlocksInAct(
      parent,
      messageStreamBlocks({
        activeThreadId: "thread",
        turnLifecycle: idleTurnLifecycle(),
        historyCursor: null,
        loadingHistory: false,
        workspaceRoot: "/vault",
        displayItems: [
          {
            id: "file-1",
            kind: "fileChange",
            role: "tool",
            text: "Changed 1 file",
            status: "completed",
            changes: [{ kind: "modified", path: "/vault/src/app.ts", diff: "-old\n+new" }],
          },
        ],
        openDetails: new Set(["file-1:file-change-details"]),
        loadOlderTurns: vi.fn(),
        renderMarkdown: (element, text) => element.createDiv({ text }),
        renderTextWithWikiLinks: (element, text) => element.createDiv({ text }),
      }),
    );

    expect(parent.querySelector(".codex-panel__tool-summary")?.textContent).toBe("src/app.ts");
    expect(parent.querySelector(".codex-panel-diff-file .codex-panel__output-title")?.textContent).toBe("modified src/app.ts");
    expect([...parent.querySelectorAll(".codex-panel-diff__line")].map((line) => line.textContent)).toEqual(["old", "new"]);
    unmountUiRootInAct(parent);
  });

  it("renders structured system result details as visible selectable meta rows", () => {
    const block = messageStreamBlocks({
      activeThreadId: "thread",
      turnLifecycle: idleTurnLifecycle(),
      historyCursor: null,
      loadingHistory: false,
      displayItems: [
        {
          id: "system-help",
          kind: "system",
          role: "system",
          text: "Available slash commands",
          markdown: false,
          details: [
            {
              rows: [
                { key: "/help", value: "Show available Codex slash commands." },
                { key: "/resume [thread]", value: "Resume a recent Codex thread." },
              ],
            },
          ],
        },
      ],
      openDetails: new Set(),
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
      renderTextWithWikiLinks: (parent, text) => parent.createDiv({ text }),
    })[0];

    const element = renderMessageBlockElement(block);

    expect(element.classList.contains("codex-panel__message--system")).toBe(true);
    expect(element.querySelector(".codex-panel__message-content")?.textContent).toBe("Available slash commands");
    expect(element.querySelector("details")).toBeNull();
    expect(element.querySelector(".codex-panel__output-title")).toBeNull();
    expect(element.querySelector(".codex-panel__meta-grid")?.textContent).toContain("/helpShow available Codex slash commands.");
    expect(element.querySelector(".codex-panel__meta-grid")?.textContent).toContain("/resume [thread]Resume a recent Codex thread.");
  });

  it("renders rollback action only for the eligible user message", () => {
    const onRollbackItem = vi.fn();
    const items = [
      { id: "u1", kind: "message", role: "user", text: "older", turnId: "turn-1", markdown: true },
      { id: "a1", kind: "message", role: "assistant", text: "older answer", turnId: "turn-1", markdown: true },
      { id: "u2", kind: "message", role: "user", text: "latest", turnId: "turn-2", markdown: true },
    ] as const;
    const blocks = messageStreamBlocks({
      activeThreadId: "thread",
      turnLifecycle: idleTurnLifecycle(),
      historyCursor: null,
      loadingHistory: false,
      displayItems: [...items],
      openDetails: new Set(),
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
      renderTextWithWikiLinks: (parent, text) => parent.createDiv({ text }),
      canRollbackItem: (item) => item.id === "u2",
      onRollbackItem,
    });

    const rendered = blocks.map((block) => renderMessageBlockElement(block));

    expect(expectPresent(rendered[0]).querySelector(".codex-panel__rollback-turn")).toBeNull();
    expect(expectPresent(rendered[1]).querySelector(".codex-panel__rollback-turn")).toBeNull();
    const button = expectPresent(rendered[2]).querySelector<HTMLButtonElement>(".codex-panel__rollback-turn");
    expect(button?.getAttribute("aria-label")).toBe("Rollback last turn");
    button?.click();
    expect(onRollbackItem).toHaveBeenCalledWith(expect.objectContaining({ id: "u2" }));
  });

  it("renders copy actions for copyable messages", () => {
    const copyText = vi.fn();
    const blocks = messageStreamBlocks({
      activeThreadId: "thread",
      turnLifecycle: idleTurnLifecycle(),
      historyCursor: null,
      loadingHistory: false,
      displayItems: [
        { id: "u1", kind: "message", role: "user", text: "rendered user", copyText: "**user**", turnId: "turn-1", markdown: true },
        { id: "a1", kind: "message", role: "assistant", text: "rendered answer", copyText: "# Answer", turnId: "turn-1", markdown: true },
      ],
      openDetails: new Set(),
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
      renderTextWithWikiLinks: (parent, text) => parent.createDiv({ text }),
      copyText,
    });

    const rendered = blocks.map((block) => renderMessageBlockElement(block));
    const userButton = expectPresent(rendered[0]).querySelector<HTMLButtonElement>(".codex-panel__copy-message");
    const assistantButton = expectPresent(rendered[1]).querySelector<HTMLButtonElement>(".codex-panel__copy-message");

    expect(userButton?.getAttribute("aria-label")).toBe("Copy message");
    expect(assistantButton?.getAttribute("aria-label")).toBe("Copy message");
    userButton?.click();
    assistantButton?.click();
    expect(copyText).toHaveBeenNthCalledWith(1, "**user**");
    expect(copyText).toHaveBeenNthCalledWith(2, "# Answer");
  });

  it("expands assistant fork actions in the copy slot and defaults repeat clicks to plain fork", () => {
    const onDetailsToggle = vi.fn();
    const onForkItem = vi.fn();
    const item: DisplayItem = {
      id: "a1",
      kind: "message",
      role: "assistant",
      text: "answer",
      copyText: "answer",
      turnId: "turn-1",
      markdown: true,
    };

    const closedBlock = messageStreamBlocks({
      activeThreadId: "thread",
      turnLifecycle: idleTurnLifecycle(),
      historyCursor: null,
      loadingHistory: false,
      displayItems: [item],
      openDetails: new Set(),
      onDetailsToggle,
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
      renderTextWithWikiLinks: (parent, text) => parent.createDiv({ text }),
      copyText: vi.fn(),
      canForkItem: () => true,
      onForkItem,
    })[0];

    const closedElement = renderMessageBlockElement(closedBlock);
    expect(closedElement.querySelector(".codex-panel__copy-message")).not.toBeNull();
    const initialFork = expectPresent(closedElement.querySelector<HTMLButtonElement>(".codex-panel__fork-message"));
    expect(initialFork.getAttribute("aria-label")).toBe("Fork from here");
    initialFork.click();
    expect(onDetailsToggle).toHaveBeenCalledWith("message:fork-actions:a1", true);

    const openBlock = messageStreamBlocks({
      activeThreadId: "thread",
      turnLifecycle: idleTurnLifecycle(),
      historyCursor: null,
      loadingHistory: false,
      displayItems: [item],
      openDetails: new Set(["message:fork-actions:a1"]),
      onDetailsToggle,
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
      renderTextWithWikiLinks: (parent, text) => parent.createDiv({ text }),
      copyText: vi.fn(),
      canForkItem: () => true,
      onForkItem,
    })[0];

    const openElement = renderMessageBlockElement(openBlock);
    expect(openElement.querySelector(".codex-panel__copy-message")).toBeNull();
    expect(openElement.querySelector<HTMLButtonElement>(".codex-panel__fork-and-archive-message")?.getAttribute("aria-label")).toBe(
      "Fork and archive",
    );
    const openFork = expectPresent(openElement.querySelector<HTMLButtonElement>(".codex-panel__fork-message"));
    expect(openFork.getAttribute("aria-label")).toBe("Fork");
    openFork.click();
    expect(onForkItem).toHaveBeenCalledWith(expect.objectContaining({ id: "a1" }), false);
  });

  it("runs fork and archive from the expanded assistant fork actions", () => {
    const onForkItem = vi.fn();
    const item: DisplayItem = {
      id: "a1",
      kind: "message",
      role: "assistant",
      text: "answer",
      copyText: "answer",
      turnId: "turn-1",
      markdown: true,
    };
    const block = messageStreamBlocks({
      activeThreadId: "thread",
      turnLifecycle: idleTurnLifecycle(),
      historyCursor: null,
      loadingHistory: false,
      displayItems: [item],
      openDetails: new Set(["message:fork-actions:a1"]),
      onDetailsToggle: vi.fn(),
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
      renderTextWithWikiLinks: (parent, text) => parent.createDiv({ text }),
      copyText: vi.fn(),
      canForkItem: () => true,
      onForkItem,
    })[0];

    const element = renderMessageBlockElement(block);
    expectPresent(element.querySelector<HTMLButtonElement>(".codex-panel__fork-and-archive-message")).click();

    expect(onForkItem).toHaveBeenCalledWith(expect.objectContaining({ id: "a1" }), true);
  });

  it("keeps message Preact actions mounted in the message stream host", () => {
    const parent = document.createElement("div");
    const copyText = vi.fn();
    const onImplementPlanItem = vi.fn();

    renderMessageStreamBlocksInAct(
      parent,
      messageStreamBlocks({
        activeThreadId: "thread",
        turnLifecycle: idleTurnLifecycle(),
        historyCursor: null,
        loadingHistory: false,
        displayItems: [
          {
            id: "p1",
            kind: "message",
            role: "assistant",
            text: "Plan",
            copyText: "Plan",
            turnId: "turn-1",
            markdown: false,
            proposedPlan: true,
          },
        ],
        openDetails: new Set(),
        loadOlderTurns: vi.fn(),
        renderMarkdown: (element, text) => element.createDiv({ text }),
        renderTextWithWikiLinks: (element, text) => element.createDiv({ text }),
        copyText,
        canImplementPlanItem: () => true,
        onImplementPlanItem,
      }),
    );

    parent.querySelector<HTMLButtonElement>(".codex-panel__copy-message")?.click();
    parent.querySelector<HTMLButtonElement>(".codex-panel__implement-plan")?.click();

    expect(copyText).toHaveBeenCalledWith("Plan");
    expect(onImplementPlanItem).toHaveBeenCalledWith(expect.objectContaining({ id: "p1" }));
    expect(parent.querySelector('[data-codex-panel-block-key="item:p1"] .codex-panel__message--assistant')).not.toBeNull();
    unmountUiRootInAct(parent);
  });

  it("renders message markdown through the Preact content adapter", () => {
    const parent = document.createElement("div");
    const renderMarkdown = vi.fn((element: HTMLElement, text: string) => {
      element.createDiv({ text: `rendered:${text}` });
    });

    renderMessageStreamBlocksInAct(
      parent,
      messageStreamBlocks({
        activeThreadId: "thread",
        turnLifecycle: idleTurnLifecycle(),
        historyCursor: null,
        loadingHistory: false,
        displayItems: [{ id: "a1", kind: "message", role: "assistant", text: "**answer**", turnId: "turn-1", markdown: true }],
        openDetails: new Set(),
        loadOlderTurns: vi.fn(),
        renderMarkdown,
        renderTextWithWikiLinks: (element, text) => element.createDiv({ text }),
      }),
    );

    expect(renderMarkdown).toHaveBeenCalledWith(expect.any(HTMLElement), "**answer**");
    expect(parent.querySelector(".codex-panel__message-content")?.textContent).toBe("rendered:**answer**");
    unmountUiRootInAct(parent);
  });

  it("updates message content when the markdown mode changes", () => {
    const parent = document.createElement("div");
    const baseContext = {
      activeThreadId: "thread",
      turnLifecycle: idleTurnLifecycle(),
      historyCursor: null,
      loadingHistory: false,
      openDetails: new Set<string>(),
      loadOlderTurns: vi.fn(),
      renderMarkdown: (element: HTMLElement, text: string) => element.createDiv({ text: `markdown:${text}` }),
      renderTextWithWikiLinks: (element: HTMLElement, text: string) => element.createDiv({ text: `text:${text}` }),
    };

    renderMessageStreamBlocksInAct(
      parent,
      messageStreamBlocks({
        ...baseContext,
        displayItems: [{ id: "a1", kind: "message", role: "assistant", text: "**answer**", turnId: "turn-1", markdown: false }],
      }),
    );
    expect(parent.querySelector(".codex-panel__message-content")?.textContent).toBe("text:**answer**");

    renderMessageStreamBlocksInAct(
      parent,
      messageStreamBlocks({
        ...baseContext,
        displayItems: [{ id: "a1", kind: "message", role: "assistant", text: "**answer**", turnId: "turn-1", markdown: true }],
      }),
    );
    expect(parent.querySelector(".codex-panel__message-content")?.textContent).toBe("markdown:**answer**");
    unmountUiRootInAct(parent);
  });

  it("updates keyed message content without replacing the stream block host", () => {
    const parent = document.createElement("div");
    const renderMarkdown = vi.fn((element: HTMLElement, text: string) => {
      element.createDiv({ text: `markdown:${text}` });
    });
    const baseContext = {
      activeThreadId: "thread",
      turnLifecycle: idleTurnLifecycle(),
      historyCursor: null,
      loadingHistory: false,
      openDetails: new Set<string>(),
      loadOlderTurns: vi.fn(),
      renderMarkdown,
      renderTextWithWikiLinks: (element: HTMLElement, text: string) => element.createDiv({ text }),
    };

    renderMessageStreamBlocksInAct(
      parent,
      messageStreamBlocks({
        ...baseContext,
        displayItems: [{ id: "a1", kind: "message", role: "assistant", text: "first", turnId: "turn-1", markdown: true }],
      }),
    );
    const host = expectPresent(parent.querySelector<HTMLElement>('[data-codex-panel-block-key="item:a1"]'));
    expect(host.querySelector(".codex-panel__message-content")?.textContent).toBe("markdown:first");

    renderMessageStreamBlocksInAct(
      parent,
      messageStreamBlocks({
        ...baseContext,
        displayItems: [{ id: "a1", kind: "message", role: "assistant", text: "second", turnId: "turn-1", markdown: true }],
      }),
    );

    expect(parent.querySelector('[data-codex-panel-block-key="item:a1"]')).toBe(host);
    expect(host.querySelector(".codex-panel__message-content")?.textContent).toBe("markdown:second");
    expect(renderMarkdown).toHaveBeenCalledTimes(2);
    unmountUiRootInAct(parent);
  });

  it("does not rerender unchanged message markdown when the stream rerenders", () => {
    const parent = document.createElement("div");
    const renderMarkdown = vi.fn((element: HTMLElement, text: string) => {
      element.createDiv({ text });
    });
    const context = {
      activeThreadId: "thread",
      turnLifecycle: idleTurnLifecycle(),
      historyCursor: null,
      loadingHistory: false,
      displayItems: [
        { id: "a1", kind: "message", role: "assistant", text: "**answer**", turnId: "turn-1", markdown: true },
      ] satisfies DisplayItem[],
      openDetails: new Set<string>(),
      loadOlderTurns: vi.fn(),
      renderMarkdown,
      renderTextWithWikiLinks: (element: HTMLElement, text: string) => element.createDiv({ text }),
    };

    renderMessageStreamBlocksInAct(parent, messageStreamBlocks(context));
    renderMessageStreamBlocksInAct(parent, messageStreamBlocks({ ...context, loadingHistory: true }));

    expect(renderMarkdown).toHaveBeenCalledOnce();
    unmountUiRootInAct(parent);
  });

  it("hides copy action for the active assistant message while a turn is running", () => {
    const item = {
      id: "a-running",
      itemId: "a-running",
      kind: "message",
      role: "assistant",
      text: "partial",
      copyText: "partial",
      turnId: "turn-1",
      markdown: false,
    } as const;
    const context = {
      activeThreadId: "thread",
      turnLifecycle: runningTurnLifecycle("turn-1"),
      historyCursor: null,
      loadingHistory: false,
      displayItems: [item],
      openDetails: new Set<string>(),
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent: HTMLElement, text: string) => parent.createDiv({ text }),
      renderTextWithWikiLinks: (parent: HTMLElement, text: string) => parent.createDiv({ text }),
      copyText: vi.fn(),
    };

    const runningBlock = messageStreamBlocks(context)[0];
    const completedBlock = messageStreamBlocks({ ...context, turnLifecycle: idleTurnLifecycle() })[0];

    expect(renderMessageBlockElement(runningBlock).querySelector(".codex-panel__copy-message")).toBeNull();
    expect(renderMessageBlockElement(completedBlock).querySelector(".codex-panel__copy-message")).not.toBeNull();
  });

  it("renders implement plan action for eligible proposed plans", () => {
    const onImplementPlanItem = vi.fn();
    const block = messageStreamBlocks({
      activeThreadId: "thread",
      turnLifecycle: idleTurnLifecycle(),
      historyCursor: null,
      loadingHistory: false,
      displayItems: [
        {
          id: "p1",
          kind: "message",
          role: "assistant",
          text: "# Plan",
          copyText: "# Plan",
          turnId: "turn-1",
          markdown: true,
          proposedPlan: true,
        },
      ],
      openDetails: new Set(),
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
      renderTextWithWikiLinks: (parent, text) => parent.createDiv({ text }),
      copyText: vi.fn(),
      canImplementPlanItem: () => true,
      onImplementPlanItem,
    })[0];

    const element = renderMessageBlockElement(block);
    const button = element.querySelector<HTMLButtonElement>(".codex-panel__implement-plan");

    expect(button?.getAttribute("aria-label")).toBe("Implement plan");
    button?.click();
    expect(onImplementPlanItem).toHaveBeenCalledWith(expect.objectContaining({ id: "p1" }));
  });

  it("orders copy, fork, and implement actions for plan messages", () => {
    const block = messageStreamBlocks({
      activeThreadId: "thread",
      turnLifecycle: idleTurnLifecycle(),
      historyCursor: null,
      loadingHistory: false,
      displayItems: [
        {
          id: "p1",
          kind: "message",
          role: "assistant",
          text: "# Plan",
          copyText: "# Plan",
          turnId: "turn-1",
          markdown: true,
          proposedPlan: true,
        },
      ],
      openDetails: new Set(),
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
      renderTextWithWikiLinks: (parent, text) => parent.createDiv({ text }),
      copyText: vi.fn(),
      canForkItem: () => true,
      onForkItem: vi.fn(),
      canImplementPlanItem: () => true,
      onImplementPlanItem: vi.fn(),
    })[0];

    const element = renderMessageBlockElement(block);
    const actions = Array.from(element.querySelectorAll<HTMLButtonElement>(".codex-panel__message-role button"));

    expect(actions.map((action) => action.getAttribute("aria-label"))).toEqual(["Copy message", "Fork from here", "Implement plan"]);
  });

  it("selects only the latest proposed plan as an implement candidate", () => {
    const firstPlan = {
      id: "p1",
      kind: "message",
      role: "assistant",
      text: "# First plan",
      turnId: "turn-1",
      proposedPlan: true,
    } as const;
    const secondPlan = {
      id: "p2",
      kind: "message",
      role: "assistant",
      text: "# Second plan",
      turnId: "turn-2",
      proposedPlan: true,
    } as const;
    const baseState = {
      activeThreadId: "thread",
      turnLifecycle: { kind: "idle" as const },
      composerDraft: "",
      selectedCollaborationMode: "plan" as const,
      displayItems: [firstPlan, { id: "a1", kind: "message", role: "assistant", text: "answer" } as const, secondPlan],
    };

    expect(implementPlanCandidateFromState(baseState)).toBe(secondPlan);
    expect(implementPlanCandidateFromState({ ...baseState, selectedCollaborationMode: "default" })).toBeNull();
    expect(implementPlanCandidateFromState({ ...baseState, composerDraft: "edit first" })).toBeNull();
    expect(implementPlanCandidateFromState({ ...baseState, turnLifecycle: { kind: "running", turnId: "turn-2" } })).toBeNull();
  });

  it("does not render copy actions for tool items", () => {
    const block = messageStreamBlocks({
      activeThreadId: "thread",
      turnLifecycle: idleTurnLifecycle(),
      historyCursor: null,
      loadingHistory: false,
      displayItems: [
        {
          id: "tool-1",
          kind: "tool",
          role: "tool",
          text: "tool summary",
          turnId: "turn",
          toolLabel: "web search",
        },
      ],
      openDetails: new Set(),
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
      renderTextWithWikiLinks: (parent, text) => parent.createDiv({ text }),
      copyText: vi.fn(),
    })[0];

    expect(renderMessageBlockElement(block).querySelector(".codex-panel__copy-message")).toBeNull();
  });

  it("renders copy and rollback actions together when both apply", () => {
    const copyText = vi.fn();
    const onRollbackItem = vi.fn();
    const block = messageStreamBlocks({
      activeThreadId: "thread",
      turnLifecycle: idleTurnLifecycle(),
      historyCursor: null,
      loadingHistory: false,
      displayItems: [{ id: "u1", kind: "message", role: "user", text: "latest", copyText: "latest", turnId: "turn-1", markdown: true }],
      openDetails: new Set(),
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
      renderTextWithWikiLinks: (parent, text) => parent.createDiv({ text }),
      copyText,
      canRollbackItem: () => true,
      onRollbackItem,
    })[0];

    const element = renderMessageBlockElement(block);
    element.querySelector<HTMLButtonElement>(".codex-panel__copy-message")?.click();
    element.querySelector<HTMLButtonElement>(".codex-panel__rollback-turn")?.click();

    expect(copyText).toHaveBeenCalledWith("latest");
    expect(onRollbackItem).toHaveBeenCalledWith(expect.objectContaining({ id: "u1" }));
  });

  it("collapses tall user messages without changing the copy payload", () => {
    withMessageContentScrollHeight(500, () => {
      const copyText = vi.fn();
      const openDetails = new Set<string>();
      const onDetailsToggle = vi.fn((key: string, open: boolean) => {
        if (open) {
          openDetails.add(key);
        } else {
          openDetails.delete(key);
        }
      });
      const block = messageStreamBlocks({
        activeThreadId: "thread",
        turnLifecycle: idleTurnLifecycle(),
        historyCursor: null,
        loadingHistory: false,
        displayItems: [
          { id: "u1", kind: "message", role: "user", text: "visible text", copyText: "full copied text", turnId: "turn-1", markdown: true },
        ],
        openDetails,
        onDetailsToggle,
        loadOlderTurns: vi.fn(),
        renderMarkdown: (parent, text) => parent.createDiv({ text }),
        renderTextWithWikiLinks: (parent, text) => parent.createDiv({ text }),
        copyText,
      })[0];

      const element = renderMessageBlockElement(block);
      const content = element.querySelector<HTMLElement>(".codex-panel__message-content");
      const details = element.querySelector<HTMLDetailsElement>(".codex-panel__message-collapse-details");

      expect(content?.classList.contains("codex-panel__message-content--collapsed")).toBe(true);
      expect(details?.hidden).toBe(false);
      expect(details?.querySelector("summary")?.textContent).toBe("Show more");

      if (details) {
        void act(() => {
          details.open = true;
          details.dispatchEvent(new Event("toggle"));
        });
      }
      expect(openDetails.has("message:u1:expanded")).toBe(true);
      expect(content?.classList.contains("codex-panel__message-content--collapsed")).toBe(false);
      expect(details?.hidden).toBe(true);
      expect(onDetailsToggle).toHaveBeenCalled();

      element.querySelector<HTMLButtonElement>(".codex-panel__copy-message")?.click();
      expect(copyText).toHaveBeenCalledWith("full copied text");
    });
  });

  it("does not show the collapse control for short user messages or assistant messages", () => {
    withMessageContentScrollHeight(120, () => {
      const shortUserBlock = messageStreamBlocks({
        activeThreadId: "thread",
        turnLifecycle: idleTurnLifecycle(),
        historyCursor: null,
        loadingHistory: false,
        displayItems: [{ id: "u1", kind: "message", role: "user", text: "short", turnId: "turn-1", markdown: true }],
        openDetails: new Set(),
        loadOlderTurns: vi.fn(),
        renderMarkdown: (parent, text) => parent.createDiv({ text }),
        renderTextWithWikiLinks: (parent, text) => parent.createDiv({ text }),
      })[0];
      const shortUser = renderMessageBlockElement(shortUserBlock);

      expect(shortUser.querySelector<HTMLDetailsElement>(".codex-panel__message-collapse-details")?.hidden).toBe(true);
    });

    withMessageContentScrollHeight(500, () => {
      const assistantBlock = messageStreamBlocks({
        activeThreadId: "thread",
        turnLifecycle: idleTurnLifecycle(),
        historyCursor: null,
        loadingHistory: false,
        displayItems: [{ id: "a1", kind: "message", role: "assistant", text: "long", turnId: "turn-1", markdown: true }],
        openDetails: new Set(),
        loadOlderTurns: vi.fn(),
        renderMarkdown: (parent, text) => parent.createDiv({ text }),
        renderTextWithWikiLinks: (parent, text) => parent.createDiv({ text }),
      })[0];
      const assistant = renderMessageBlockElement(assistantBlock);

      expect(assistant.querySelector(".codex-panel__message-collapse-details")).toBeNull();
    });
  });

  it("does not render rollback action when no item is eligible", () => {
    const block = messageStreamBlocks({
      activeThreadId: "thread",
      turnLifecycle: startingTurnLifecycle(),
      historyCursor: null,
      loadingHistory: false,
      displayItems: [{ id: "u1", kind: "message", role: "user", text: "running", turnId: "turn-1", markdown: true }],
      openDetails: new Set(),
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
      renderTextWithWikiLinks: (parent, text) => parent.createDiv({ text }),
      canRollbackItem: () => false,
      onRollbackItem: vi.fn(),
    })[0];

    expect(renderMessageBlockElement(block).querySelector(".codex-panel__rollback-turn")).toBeNull();
  });

  it("renders command items as a compact summary with output behind details", () => {
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
          text: "npm run check (exit 1)",
          turnId: "turn",
          command: "npm run check",
          cwd: "/vault",
          status: "failed",
          exitCode: 1,
          output: "stderr details",
        },
      ],
      openDetails: new Set(),
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
      renderTextWithWikiLinks: (parent, text) => parent.createDiv({ text }),
    })[0];

    const element = renderMessageBlockElement(block);

    expect(element.querySelector(".codex-panel__tool-summary")?.textContent).toBe("npm run check (exit 1)");
    expect(element.querySelector(".codex-panel__tool-summary")?.getAttribute("title")).toBeNull();
    expect(topLevelDetailsSummaries(element)).toEqual(["command"]);
    expect([...element.querySelectorAll("details summary")].map((summary) => summary.textContent)).toEqual(["command"]);
    expect(element.textContent).not.toContain("Details");
    expect([...element.querySelectorAll(".codex-panel__output-title")].map((title) => title.textContent)).toEqual(["Output"]);
    expect(element.querySelector(".codex-panel__output pre")?.textContent).toBe("stderr details");
    expect(element.querySelector("details")?.hasAttribute("open")).toBe(false);
  });

  it("omits command exit and duration rows while they are unavailable", () => {
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
          status: "inProgress",
          output: "",
        },
      ],
      openDetails: new Set(),
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
      renderTextWithWikiLinks: (parent, text) => parent.createDiv({ text }),
    })[0];

    const element = renderMessageBlockElement(block);
    const metaText = element.querySelector(".codex-panel__meta-grid")?.textContent ?? "";

    expect(metaText).toContain("commandnpm run check");
    expect(metaText).toContain("statusinProgress");
    expect(metaText).not.toContain("exit");
    expect(metaText).not.toContain("duration");
    expect(metaText).not.toContain("undefined");
  });

  it("uses read as the command header for parsed file reads", () => {
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
          actionLabel: "read",
          text: "sed /vault/src/main.ts",
          turnId: "turn",
          command: "sed -n '1,20p' src/main.ts",
          cwd: "/vault",
          status: "completed",
          exitCode: 0,
          output: "contents",
        },
      ],
      openDetails: new Set(),
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
      renderTextWithWikiLinks: (parent, text) => parent.createDiv({ text }),
    })[0];

    const element = renderMessageBlockElement(block);

    expect([...element.querySelectorAll("details summary")].map((summary) => summary.textContent)).toEqual(["read"]);
  });

  it("renders file diffs inside a single file change details block", () => {
    const block = messageStreamBlocks({
      activeThreadId: "thread",
      turnLifecycle: runningTurnLifecycle("turn"),
      historyCursor: null,
      loadingHistory: false,
      workspaceRoot: "/vault/project",
      displayItems: [
        {
          id: "patch-1",
          kind: "fileChange",
          role: "tool",
          text: "/vault/project/src/main.ts",
          turnId: "turn",
          status: "completed",
          changes: [{ kind: "update", path: "/vault/project/src/main.ts", diff: "@@\n-old\n+new" }],
          output: "patch applied",
        },
      ],
      openDetails: new Set(),
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
      renderTextWithWikiLinks: (parent, text) => parent.createDiv({ text }),
    })[0];

    const element = renderMessageBlockElement(block);

    expect(element.querySelector(".codex-panel__tool-summary")?.textContent).toBe("src/main.ts");
    expect(topLevelDetailsSummaries(element)).toEqual(["file change"]);
    expect([...element.querySelectorAll("details summary")].map((summary) => summary.textContent)).toEqual(["file change"]);
    expect(element.textContent).not.toContain("Details");
    expect([...element.querySelectorAll(".codex-panel__output-title")].map((title) => title.textContent)).toEqual([
      "update src/main.ts",
      "Patch output",
    ]);
  });

  it("renders the edited files footer with an open diff action when aggregated turn diff exists", () => {
    const openTurnDiff = vi.fn();
    const blocks = messageStreamBlocks({
      activeThreadId: "thread",
      turnLifecycle: idleTurnLifecycle(),
      historyCursor: null,
      loadingHistory: false,
      workspaceRoot: "/vault/project",
      displayItems: [
        {
          id: "patch-1",
          kind: "fileChange",
          role: "tool",
          text: "File change completed",
          turnId: "turn",
          status: "completed",
          changes: [{ kind: "update", path: "/vault/project/src/main.ts", diff: "@@\n-old\n+new" }],
        },
        { id: "a1", kind: "message", role: "assistant", text: "Done", turnId: "turn", markdown: true },
      ],
      turnDiffs: new Map([["turn", "diff --git a/src/main.ts b/src/main.ts\n@@\n-old\n+new"]]),
      openDetails: new Set(),
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
      renderTextWithWikiLinks: (parent, text) => parent.createDiv({ text }),
      openTurnDiff,
    });

    const assistant = renderMessageBlockElement(expectPresent(blocks.find((block) => block.key === "item:a1")));
    const button = assistant.querySelector<HTMLButtonElement>(".codex-panel__open-turn-diff");

    expect(assistant.querySelector(".codex-panel__edited-files")?.textContent).toContain("Edited 1 file");
    expect(button?.getAttribute("aria-label")).toBe("View diff");
    expect(button?.textContent).toContain("View diff");
    button?.click();
    expect(openTurnDiff).toHaveBeenCalledWith({
      threadId: "thread",
      turnId: "turn",
      cwd: "/vault/project",
      files: ["src/main.ts"],
      diff: "diff --git a/src/main.ts b/src/main.ts\n@@\n-old\n+new",
    });
  });

  it("renders referenced thread metadata without exposing hidden context", () => {
    const blocks = messageStreamBlocks({
      activeThreadId: "thread",
      turnLifecycle: idleTurnLifecycle(),
      historyCursor: null,
      loadingHistory: false,
      displayItems: [
        {
          id: "u1",
          kind: "message",
          role: "user",
          text: "この続きです",
          copyText: "この続きです",
          markdown: true,
          referencedThread: {
            threadId: "thread-reference",
            title: "参照元",
            includedTurns: 2,
            turnLimit: 20,
          },
        },
      ],
      openDetails: new Set(),
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
      renderTextWithWikiLinks: (parent, text) => parent.createDiv({ text }),
    });

    const user = renderMessageBlockElement(expectPresent(blocks.find((block) => block.key === "item:u1")));

    expect(user.querySelector(".codex-panel__message-content")?.textContent).toBe("この続きです");
    expect(user.querySelector(".codex-panel__referenced-thread")?.textContent).toContain("Referenced 参照元");
    expect(user.querySelector(".codex-panel__referenced-thread")?.textContent).toContain("2/20 turns");
    expect(user.querySelector<HTMLElement>(".codex-panel__referenced-thread")?.getAttribute("title")).toBeNull();
  });

  it("renders resolved file mentions as a collapsed user message attachment", () => {
    const blocks = messageStreamBlocks({
      activeThreadId: "thread",
      turnLifecycle: idleTurnLifecycle(),
      historyCursor: null,
      loadingHistory: false,
      displayItems: [
        {
          id: "u1",
          kind: "message",
          role: "user",
          text: "Read [[Alpha]].",
          copyText: "Read [[Alpha]].",
          markdown: true,
          mentionedFiles: [{ name: "Alpha", path: "thoughts/Alpha.md" }],
        },
      ],
      openDetails: new Set(),
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
      renderTextWithWikiLinks: (parent, text) => parent.createDiv({ text }),
    });

    const user = renderMessageBlockElement(expectPresent(blocks.find((block) => block.key === "item:u1")));

    expect(user.querySelector(".codex-panel__message-content")?.textContent).toBe("Read [[Alpha]].");
    expect(user.querySelector(".codex-panel__mentioned-files summary")?.textContent).toBe("Mentioned 1 file");
    expect(user.querySelector(".codex-panel__mentioned-files")?.textContent).toContain("Alpha");
    expect(user.querySelector(".codex-panel__mentioned-files")?.textContent).toContain("thoughts/Alpha.md");
  });

  it("does not render the open diff action without aggregated turn diff", () => {
    const blocks = messageStreamBlocks({
      activeThreadId: "thread",
      turnLifecycle: idleTurnLifecycle(),
      historyCursor: null,
      loadingHistory: false,
      displayItems: [
        {
          id: "patch-1",
          kind: "fileChange",
          role: "tool",
          text: "File change completed",
          turnId: "turn",
          status: "completed",
          changes: [{ kind: "update", path: "src/main.ts", diff: "@@\n-old\n+new" }],
        },
        { id: "a1", kind: "message", role: "assistant", text: "Done", turnId: "turn", markdown: true },
      ],
      openDetails: new Set(),
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
      renderTextWithWikiLinks: (parent, text) => parent.createDiv({ text }),
      openTurnDiff: vi.fn(),
    });

    const assistant = renderMessageBlockElement(expectPresent(blocks.find((block) => block.key === "item:a1")));

    expect(assistant.querySelector(".codex-panel__edited-files")?.textContent).toContain("Edited 1 file");
    expect(assistant.querySelector(".codex-panel__open-turn-diff")).toBeNull();
  });
});
