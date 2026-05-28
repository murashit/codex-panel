// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactNode } from "react";

import type { PendingApproval } from "../../../../src/features/chat/approvals/model";
import type { PendingUserInput } from "../../../../src/features/chat/user-input/model";
import { pendingRequestMessageNode, type PendingRequestMessageActions } from "../../../../src/features/chat/ui/pending-request-message";
import type { DisplayItem } from "../../../../src/features/chat/display/types";
import { implementPlanCandidateFromState } from "../../../../src/features/chat/chat-message-renderer";
import type { ChatTurnLifecycleState } from "../../../../src/features/chat/chat-state";
import { messageStreamBlocks as rawMessageStreamBlocks, renderMessageStreamBlocks } from "../../../../src/features/chat/ui/message-stream";
import { changeInputValue, installObsidianDomShims, topLevelDetailsSummaries } from "./dom-test-helpers";
import { renderReactRoot, unmountReactRoot } from "../../../../src/shared/ui/react-root";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

installObsidianDomShims();

function messageStreamBlocks(
  ...args: Parameters<typeof rawMessageStreamBlocks>
): [ReturnType<typeof rawMessageStreamBlocks>[number], ...ReturnType<typeof rawMessageStreamBlocks>] {
  const blocks = rawMessageStreamBlocks(...args);
  if (blocks.length === 0) throw new Error("Expected at least one message stream block.");
  return blocks as [ReturnType<typeof rawMessageStreamBlocks>[number], ...ReturnType<typeof rawMessageStreamBlocks>];
}

function expectPresent<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected value to be present");
  return value;
}

function setNativeInputValue(input: HTMLInputElement, value: string): void {
  const valueDescriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  if (!valueDescriptor?.set) throw new Error("Missing input value setter");
  valueDescriptor.set.call(input, value);
}

function dispatchComposingInputValue(input: HTMLInputElement, value: string): void {
  setNativeInputValue(input, value);
  const event = new Event("input", { bubbles: true });
  Object.defineProperty(event, "isComposing", { value: true });
  input.dispatchEvent(event);
}

function testMessageStreamBlock(key: string, node: ReactNode): ReturnType<typeof rawMessageStreamBlocks>[number] {
  return { key, node };
}

function renderMessageBlockElement(block: ReturnType<typeof rawMessageStreamBlocks>[number]): HTMLElement {
  const parent = document.createElement("div");
  act(() => {
    renderMessageStreamBlocks(parent, [block]);
  });
  const host = expectPresent(parent.querySelector<HTMLElement>(`[data-codex-panel-block-key="${block.key}"]`));
  return expectPresent(host.firstElementChild as HTMLElement | null);
}

function renderPendingRequestNode(parent: HTMLElement, ...args: Parameters<typeof pendingRequestMessageNode>): void {
  renderReactRoot(parent, pendingRequestMessageNode(...args));
}

function pendingRequestActions(overrides: Partial<PendingRequestMessageActions> = {}): PendingRequestMessageActions {
  return {
    resolveApproval: vi.fn(),
    resolveUserInput: vi.fn(),
    cancelUserInput: vi.fn(),
    setUserInputDraft: vi.fn(),
    ...overrides,
  };
}

function idleTurnLifecycle(): ChatTurnLifecycleState {
  return { kind: "idle" };
}

function runningTurnLifecycle(turnId = "turn"): ChatTurnLifecycleState {
  return { kind: "running", turnId };
}

function startingTurnLifecycle(): ChatTurnLifecycleState {
  return { kind: "starting", pendingTurnStart: { anchorItemId: "local-user", promptSubmitHookItemIds: [] } };
}

function withMessageContentScrollHeight<T>(scrollHeight: number, fn: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get() {
      return this.classList.contains("codex-panel__message-content") ? scrollHeight : 0;
    },
  });
  try {
    return fn();
  } finally {
    if (descriptor) {
      Object.defineProperty(HTMLElement.prototype, "scrollHeight", descriptor);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "scrollHeight");
    }
  }
}

describe("message stream block identity and message actions", () => {
  it("reuses keyed React message block hosts across rerenders", () => {
    const parent = document.createElement("div");
    renderMessageStreamBlocks(parent, [testMessageStreamBlock("one", createElement("section", null, "first"))]);

    const host = expectPresent(parent.querySelector<HTMLElement>('[data-codex-panel-block-key="one"]'));
    expect(host.classList.contains("codex-panel__message-block")).toBe(true);
    expect(host.firstElementChild?.tagName).toBe("SECTION");
    expect(host.textContent).toBe("first");

    renderMessageStreamBlocks(parent, [testMessageStreamBlock("one", createElement("section", null, "still first"))]);

    expect(parent.querySelector('[data-codex-panel-block-key="one"]')).toBe(host);
    expect(host.firstElementChild?.tagName).toBe("SECTION");
    expect(host.textContent).toBe("still first");

    renderMessageStreamBlocks(parent, [testMessageStreamBlock("one", createElement("article", null, "replacement"))]);

    expect(parent.querySelector('[data-codex-panel-block-key="one"]')).toBe(host);
    expect(host.firstElementChild?.tagName).toBe("ARTICLE");
    renderMessageStreamBlocks(parent, []);
    expect(parent.querySelector('[data-codex-panel-block-key="one"]')).toBeNull();
    unmountReactRoot(parent);
  });

  it("leaves stable ordered React message block hosts in place during repeated renders", () => {
    const parent = document.createElement("div");
    renderMessageStreamBlocks(parent, [
      testMessageStreamBlock("one", createElement("section", null, "one")),
      testMessageStreamBlock("two", createElement("article", null, "two")),
    ]);
    const firstHost = expectPresent(parent.querySelector<HTMLElement>('[data-codex-panel-block-key="one"]'));
    const secondHost = expectPresent(parent.querySelector<HTMLElement>('[data-codex-panel-block-key="two"]'));

    const insertBefore = vi.spyOn(parent, "insertBefore");
    renderMessageStreamBlocks(parent, [
      testMessageStreamBlock("one", createElement("section", null, "one again")),
      testMessageStreamBlock("two", createElement("article", null, "two again")),
    ]);

    expect(insertBefore).not.toHaveBeenCalled();
    expect([...parent.children]).toEqual([firstHost, secondHost]);
    expect(firstHost.firstElementChild?.tagName).toBe("SECTION");
    expect(secondHost.firstElementChild?.tagName).toBe("ARTICLE");
    unmountReactRoot(parent);
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

    renderMessageStreamBlocks(
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

    renderMessageStreamBlocks(
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
    unmountReactRoot(parent);
  });

  it("renders the history bar as a React block", () => {
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
    renderReactRoot(parent, historyBlock.node);

    const button = expectPresent(parent.querySelector<HTMLButtonElement>("button"));
    expect(parent.querySelector(".codex-panel__history-bar")).not.toBeNull();
    expect(button.textContent).toBe("Load older");
    expect(button.disabled).toBe(false);

    button.click();

    expect(loadOlderTurns).toHaveBeenCalledOnce();
    unmountReactRoot(parent);
  });

  it("renders the empty message stream state as a React block", () => {
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
    renderReactRoot(parent, emptyBlock.node);

    const empty = expectPresent(parent.querySelector<HTMLElement>(".codex-panel__message--system"));
    expect(empty.classList.contains("codex-panel__message")).toBe(true);
    expect(empty.textContent).toBe("Send a message to start a conversation.");
    unmountReactRoot(parent);
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
          state: "completed",
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

  it("keeps tool result React details mounted in the message stream host", () => {
    const parent = document.createElement("div");
    const onDetailsToggle = vi.fn();
    const renderTextWithWikiLinks = vi.fn((element: HTMLElement, text: string) => {
      element.createDiv({ text: `linked:${text}` });
    });

    renderMessageStreamBlocks(
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
            state: "completed",
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
    details.open = true;
    details.dispatchEvent(new Event("toggle", { bubbles: false }));

    expect(onDetailsToggle).toHaveBeenCalledWith("cmd-1:command-details", true);
    unmountReactRoot(parent);
  });

  it("renders file change diffs through the React tool result adapter", () => {
    const parent = document.createElement("div");

    renderMessageStreamBlocks(
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
    unmountReactRoot(parent);
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

  it("keeps message React actions mounted in the message stream host", () => {
    const parent = document.createElement("div");
    const copyText = vi.fn();
    const onImplementPlanItem = vi.fn();

    renderMessageStreamBlocks(
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
    unmountReactRoot(parent);
  });

  it("renders message markdown through the React content adapter", () => {
    const parent = document.createElement("div");
    const renderMarkdown = vi.fn((element: HTMLElement, text: string) => {
      element.createDiv({ text: `rendered:${text}` });
    });

    renderMessageStreamBlocks(
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
    unmountReactRoot(parent);
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

    renderMessageStreamBlocks(
      parent,
      messageStreamBlocks({
        ...baseContext,
        displayItems: [{ id: "a1", kind: "message", role: "assistant", text: "**answer**", turnId: "turn-1", markdown: false }],
      }),
    );
    expect(parent.querySelector(".codex-panel__message-content")?.textContent).toBe("text:**answer**");

    renderMessageStreamBlocks(
      parent,
      messageStreamBlocks({
        ...baseContext,
        displayItems: [{ id: "a1", kind: "message", role: "assistant", text: "**answer**", turnId: "turn-1", markdown: true }],
      }),
    );
    expect(parent.querySelector(".codex-panel__message-content")?.textContent).toBe("markdown:**answer**");
    unmountReactRoot(parent);
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

    renderMessageStreamBlocks(
      parent,
      messageStreamBlocks({
        ...baseContext,
        displayItems: [{ id: "a1", kind: "message", role: "assistant", text: "first", turnId: "turn-1", markdown: true }],
      }),
    );
    const host = expectPresent(parent.querySelector<HTMLElement>('[data-codex-panel-block-key="item:a1"]'));
    expect(host.querySelector(".codex-panel__message-content")?.textContent).toBe("markdown:first");

    renderMessageStreamBlocks(
      parent,
      messageStreamBlocks({
        ...baseContext,
        displayItems: [{ id: "a1", kind: "message", role: "assistant", text: "second", turnId: "turn-1", markdown: true }],
      }),
    );

    expect(parent.querySelector('[data-codex-panel-block-key="item:a1"]')).toBe(host);
    expect(host.querySelector(".codex-panel__message-content")?.textContent).toBe("markdown:second");
    expect(renderMarkdown).toHaveBeenCalledTimes(2);
    unmountReactRoot(parent);
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

    renderMessageStreamBlocks(parent, messageStreamBlocks(context));
    renderMessageStreamBlocks(parent, messageStreamBlocks({ ...context, loadingHistory: true }));

    expect(renderMarkdown).toHaveBeenCalledOnce();
    unmountReactRoot(parent);
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
      requestedCollaborationMode: "plan" as const,
      displayItems: [firstPlan, { id: "a1", kind: "message", role: "assistant", text: "answer" } as const, secondPlan],
    };

    expect(implementPlanCandidateFromState(baseState)).toBe(secondPlan);
    expect(implementPlanCandidateFromState({ ...baseState, requestedCollaborationMode: "default" })).toBeNull();
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
        details.open = true;
        act(() => {
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
      renderTextWithWikiLinks: (parent, text) => parent.createDiv({ text }),
    })[0];

    const element = renderMessageBlockElement(block);

    expect(element.querySelector(".codex-panel__tool-summary")?.textContent).toBe("123");
    expect(topLevelDetailsSummaries(element)).toEqual(["github.pull_request_read"]);
    expect([...element.querySelectorAll("details summary")].map((summary) => summary.textContent)).toEqual(["github.pull_request_read"]);
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
      renderTextWithWikiLinks: (parent, text) => parent.createDiv({ text }),
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
      renderTextWithWikiLinks: (parent, text) => parent.createDiv({ text }),
    })[0];

    const element = renderMessageBlockElement(block);

    expect(element.classList.contains("codex-panel__tool-result--plain")).toBe(true);
    expect(element.querySelector(".codex-panel__tool-result-header")?.textContent).toBe("web search");
    expect(element.querySelector(".codex-panel__tool-summary")?.textContent).toBe("https://example.com");
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
      renderTextWithWikiLinks: (parent, text) => parent.createDiv({ text }),
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
      renderTextWithWikiLinks: (element: HTMLElement, text: string) => element.createDiv({ text }),
    };

    renderMessageStreamBlocks(parent, messageStreamBlocks({ ...baseContext, workspaceRoot: "/vault" }));
    expect(parent.querySelector(".codex-panel__tool-summary")?.textContent).toBe("project/assets/image.png");

    renderMessageStreamBlocks(parent, messageStreamBlocks({ ...baseContext, workspaceRoot: "/vault/project" }));
    expect(parent.querySelector(".codex-panel__tool-summary")?.textContent).toBe("assets/image.png");
    unmountReactRoot(parent);
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
      renderTextWithWikiLinks: (parent, text) => parent.createDiv({ text }),
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
      renderTextWithWikiLinks: (parent, text) => parent.createDiv({ text }),
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
      renderTextWithWikiLinks: (parent, text) => parent.createDiv({ text }),
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
        { id: "u1", kind: "message", role: "user", text: "do it", turnId: "turn", markdown: true },
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
        { id: "a1", kind: "message", role: "assistant", text: "done", turnId: "turn", markdown: true },
      ],
      openDetails: new Set(["turn:turn:activity", "hook-1"]),
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
      renderTextWithWikiLinks: (parent, text) => parent.createDiv({ text }),
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

  it("keeps completed-turn activity group items mounted through React", () => {
    const parent = document.createElement("div");
    const onDetailsToggle = vi.fn();

    renderMessageStreamBlocks(
      parent,
      messageStreamBlocks({
        activeThreadId: "thread",
        turnLifecycle: idleTurnLifecycle(),
        historyCursor: null,
        loadingHistory: false,
        displayItems: [
          { id: "u1", kind: "message", role: "user", text: "do it", turnId: "turn", markdown: true },
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
          { id: "a1", kind: "message", role: "assistant", text: "done", turnId: "turn", markdown: true },
        ],
        openDetails: new Set(["turn:turn:activity", "hook-1:details"]),
        onDetailsToggle,
        loadOlderTurns: vi.fn(),
        renderMarkdown: (element, text) => element.createDiv({ text }),
        renderTextWithWikiLinks: (element, text) => element.createDiv({ text }),
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
    details.open = false;
    details.dispatchEvent(new Event("toggle", { bubbles: false }));

    expect(onDetailsToggle).toHaveBeenCalledWith("turn:turn:activity", false);
    unmountReactRoot(parent);
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
      renderTextWithWikiLinks: (parent, text) => parent.createDiv({ text }),
    })[0];

    const element = renderMessageBlockElement(block);

    expect(element.classList.contains("codex-panel__work-message")).toBe(true);
    expect(element.classList.contains("codex-panel__task-progress")).toBe(true);
    expect(element.querySelector(".codex-panel__message-role")?.textContent).toBe("tasks");
    expect(element.textContent).toContain("[x]Inspect code");
    expect(element.textContent).toContain("[>]Patch UI");
  });

  it("keeps task progress React items mounted in the message stream host", () => {
    const parent = document.createElement("div");

    renderMessageStreamBlocks(
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
        renderTextWithWikiLinks: (element, text) => element.createDiv({ text }),
      }),
    );

    const block = expectPresent(parent.querySelector<HTMLElement>('[data-codex-panel-block-key="item:plan-progress-turn"]'));
    expect(block.querySelector(".codex-panel__task-progress .codex-panel__message-role")?.textContent).toBe("tasks");
    expect(block.textContent).toContain("[x]Inspect code");
    expect(block.textContent).toContain("[>]Patch UI");
    unmountReactRoot(parent);
  });

  it("renders agent activity with target state and prompt details", () => {
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
      renderTextWithWikiLinks: (parent, text) => parent.createDiv({ text }),
    })[0];

    const element = renderMessageBlockElement(block);

    expect(element.classList.contains("codex-panel__work-message")).toBe(true);
    expect(element.classList.contains("codex-panel__agent-activity")).toBe(true);
    expect(element.querySelector(".codex-panel__message-role")?.textContent).toBe("agent");
    expect(element.querySelector(".codex-panel__tool-summary")?.textContent).toBe("spawn child (completed)");
    expect(element.textContent).toContain("child");
    expect(element.textContent).toContain("completed: Done");
    expect([...element.querySelectorAll("details summary")].map((summary) => summary.textContent)).toEqual(["Details", "Prompt"]);
  });

  it("keeps agent React details mounted in the message stream host", () => {
    const parent = document.createElement("div");
    const onDetailsToggle = vi.fn();

    renderMessageStreamBlocks(
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
        renderTextWithWikiLinks: (element, text) => element.createDiv({ text }),
      }),
    );

    const block = expectPresent(parent.querySelector<HTMLElement>('[data-codex-panel-block-key="item:agent-1"]'));
    expect(block.querySelector(".codex-panel__agent-activity .codex-panel__message-role")?.textContent).toBe("agent");
    expect(block.querySelector(".codex-panel__tool-summary")?.textContent).toBe("spawn child (completed)");
    expect([...block.querySelectorAll("details summary")].map((summary) => summary.textContent)).toEqual(["Details", "Prompt"]);

    const details = expectPresent(block.querySelector<HTMLDetailsElement>("details"));
    details.open = true;
    details.dispatchEvent(new Event("toggle", { bubbles: false }));

    expect(onDetailsToggle).toHaveBeenCalledWith("agent-1:agent-details", true);
    unmountReactRoot(parent);
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
      renderTextWithWikiLinks: (parent, text) => parent.createDiv({ text }),
    })[0];

    const element = renderMessageBlockElement(block);

    expect(element.querySelector(".codex-panel__agent-thread")?.textContent).toBe("019e061e");
    expect(element.querySelector(".codex-panel__agent-status")?.textContent).toBe("completed: Done");
    expect(element.querySelector(".codex-panel__agent-status")?.textContent).not.toContain("a".repeat(180));
    expect([...element.querySelectorAll("details summary")].map((summary) => summary.textContent)).toEqual([
      "Details",
      "Agent output 019e061e",
    ]);
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
      renderTextWithWikiLinks: (parent, text) => parent.createDiv({ text }),
    });

    const summary = renderMessageBlockElement(expectPresent(blocks.at(-1)));

    expect(summary.classList.contains("codex-panel__work-message")).toBe(true);
    expect(summary.classList.contains("codex-panel__agent-summary")).toBe(true);
    expect(summary.textContent).toContain("agents");
    expect(summary.textContent).toContain("Agents 1 running, 1 done");
    expect(summary.textContent).toContain("runningrunning: Inspecting renderer");
    expect(summary.textContent).toContain("donecompleted");
  });

  it("renders the compact live agent summary as a React block", () => {
    const parent = document.createElement("div");

    renderMessageStreamBlocks(
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
        renderTextWithWikiLinks: (element, text) => element.createDiv({ text }),
      }),
    );

    const summary = expectPresent(parent.querySelector<HTMLElement>('[data-codex-panel-block-key="active-agents:turn"]'));
    expect(summary.querySelector(".codex-panel__agent-summary")?.textContent).toContain("Agents 1 running, 1 done");
    expect(summary.textContent).toContain("runningrunning: Inspecting renderer");
    unmountReactRoot(parent);
  });

  it("renders active reasoning as a React message stream block", () => {
    const parent = document.createElement("div");

    renderMessageStreamBlocks(
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
        renderTextWithWikiLinks: (element, text) => element.createDiv({ text }),
      }),
    );

    const reasoning = expectPresent(
      parent.querySelector<HTMLElement>('[data-codex-panel-block-key="item:reasoning-1"] .codex-panel__reasoning'),
    );
    expect(reasoning.classList.contains("is-active")).toBe(true);
    expect(reasoning.querySelector(".codex-panel__reasoning-role")?.textContent).toBe("reasoning");
    expect(reasoning.querySelector(".codex-panel__reasoning-content")?.textContent).toBe("Reasoning...");
    unmountReactRoot(parent);
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
      renderTextWithWikiLinks: (parent, text) => parent.createDiv({ text }),
    });

    expect(blocks.some((block) => block.key.startsWith("active-agents:"))).toBe(false);
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
      renderTextWithWikiLinks: (parent, text) => parent.createDiv({ text }),
    });

    const summary = renderMessageBlockElement(expectPresent(blocks.at(-1)));

    expect(summary.classList.contains("codex-panel__execution--failed")).toBe(true);
    expect(summary.textContent).toContain("Agents 1 failed, 1 running");
    expect(summary.textContent).toContain("failederrored: Failed");
  });
});

describe("pending request renderer decisions", () => {
  it("renders pending requests as one message-stream block and keeps user input drafts live", () => {
    const parent = document.createElement("div");
    const drafts = new Map<string, string>();
    const resolveUserInput = vi.fn();
    const input = pendingUserInput();

    renderPendingRequestNode(
      parent,
      [],
      [input],
      {
        values: drafts,
        draftKey: (requestId, questionId) => `${String(requestId)}:${questionId}`,
        otherDraftKey: (requestId, questionId) => `${String(requestId)}:${questionId}:other`,
      },
      new Set(),
      pendingRequestActions({ resolveUserInput }),
    );

    expect(parent.querySelectorAll(".codex-panel__pending-request-message")).toHaveLength(1);
    expect(parent.querySelector(".codex-panel__pending-request-message")?.classList.contains("codex-panel__work-message")).toBe(true);
    expect(parent.querySelector(".codex-panel__pending-request-message")?.classList.contains("codex-panel__work-message--warning")).toBe(
      true,
    );
    expect(parent.querySelector<HTMLButtonElement>(".codex-panel__pending-request-button.mod-cta")?.textContent).toBe("Submit");
    expect(parent.querySelector(".codex-panel__user-input-answer .codex-panel__user-input-radio")).not.toBeNull();
    expect(parent.querySelector<HTMLInputElement>(".codex-panel__user-input-radio")?.checked).toBe(true);
    expect(parent.querySelector<HTMLInputElement>(".codex-panel__user-input-radio")?.type).toBe("radio");
    expect(parent.querySelector(".codex-panel__user-input-marker")).toBeNull();
    parent.querySelector<HTMLButtonElement>(".mod-cta")?.click();
    expect(resolveUserInput).toHaveBeenCalledWith(input);
  });

  it("selects the other Plan mode answer from controlled drafts", () => {
    const parent = document.createElement("div");
    const drafts = new Map<string, string>();
    const input = pendingOtherUserInput();
    const draftKey = (requestId: PendingUserInput["requestId"], questionId: string) => `${String(requestId)}:${questionId}`;
    const otherDraftKey = (requestId: PendingUserInput["requestId"], questionId: string) => `${String(requestId)}:${questionId}:other`;
    const actions = pendingRequestActions({
      setUserInputDraft: vi.fn((key: string, value: string) => {
        drafts.set(key, value);
      }),
    });
    const render = () => {
      renderPendingRequestNode(parent, [], [input], { values: drafts, draftKey, otherDraftKey }, new Set(), actions);
    };

    render();
    changeInputValue(expectPresent(parent.querySelector<HTMLInputElement>(".codex-panel__user-input-other-text")), "Custom scope");

    expect(actions.setUserInputDraft).toHaveBeenCalledWith("99:scope:other", "Custom scope");
    expect(actions.setUserInputDraft).toHaveBeenCalledWith("99:scope", "Custom scope");

    render();
    const radios = [...parent.querySelectorAll<HTMLInputElement>(".codex-panel__user-input-radio")];
    expect(radios.map((radio) => radio.checked)).toEqual([false, true]);
  });

  it("keeps the other Plan mode radio selected when the custom answer is empty", () => {
    const parent = document.createElement("div");
    const drafts = new Map<string, string>();
    const input = pendingOtherUserInput();
    const draftKey = (requestId: PendingUserInput["requestId"], questionId: string) => `${String(requestId)}:${questionId}`;
    const otherDraftKey = (requestId: PendingUserInput["requestId"], questionId: string) => `${String(requestId)}:${questionId}:other`;
    const actions = pendingRequestActions({
      setUserInputDraft: vi.fn((key: string, value: string) => {
        drafts.set(key, value);
      }),
    });
    const render = () => {
      renderPendingRequestNode(parent, [], [input], { values: drafts, draftKey, otherDraftKey }, new Set(), actions);
    };

    render();
    const radios = [...parent.querySelectorAll<HTMLInputElement>(".codex-panel__user-input-radio")];
    expect(radios.map((radio) => radio.checked)).toEqual([true, false]);

    expectPresent(radios.at(1)).click();

    expect(actions.setUserInputDraft).toHaveBeenCalledWith("99:scope", "");

    render();
    const rerenderedRadios = [...parent.querySelectorAll<HTMLInputElement>(".codex-panel__user-input-radio")];
    expect(rerenderedRadios.map((radio) => radio.checked)).toEqual([false, true]);
  });

  it("keeps unselected other Plan mode text out of tab order", () => {
    const parent = document.createElement("div");
    const drafts = new Map<string, string>();
    const input = pendingOtherUserInput();
    const draftKey = (requestId: PendingUserInput["requestId"], questionId: string) => `${String(requestId)}:${questionId}`;
    const otherDraftKey = (requestId: PendingUserInput["requestId"], questionId: string) => `${String(requestId)}:${questionId}:other`;
    const actions = pendingRequestActions({
      setUserInputDraft: vi.fn((key: string, value: string) => {
        drafts.set(key, value);
      }),
    });
    const render = () => {
      renderPendingRequestNode(parent, [], [input], { values: drafts, draftKey, otherDraftKey }, new Set(), actions);
    };

    render();

    expect(parent.querySelector<HTMLInputElement>(".codex-panel__user-input-other-text")?.tabIndex).toBe(-1);

    expectPresent(parent.querySelectorAll<HTMLInputElement>(".codex-panel__user-input-radio").item(1)).click();
    render();

    expect(parent.querySelector<HTMLInputElement>(".codex-panel__user-input-other-text")?.tabIndex).toBe(0);
  });

  it("does not commit other Plan mode IME preedit text as the answer", () => {
    const parent = document.createElement("div");
    const drafts = new Map<string, string>();
    const input = pendingOtherUserInput();
    const draftKey = (requestId: PendingUserInput["requestId"], questionId: string) => `${String(requestId)}:${questionId}`;
    const otherDraftKey = (requestId: PendingUserInput["requestId"], questionId: string) => `${String(requestId)}:${questionId}:other`;
    const actions = pendingRequestActions({
      setUserInputDraft: vi.fn((key: string, value: string) => {
        drafts.set(key, value);
      }),
    });

    renderPendingRequestNode(parent, [], [input], { values: drafts, draftKey, otherDraftKey }, new Set(), actions);
    const otherInput = expectPresent(parent.querySelector<HTMLInputElement>(".codex-panel__user-input-other-text"));

    otherInput.dispatchEvent(new Event("compositionstart", { bubbles: true }));
    dispatchComposingInputValue(otherInput, "にほん");

    expect(actions.setUserInputDraft).toHaveBeenCalledWith("99:scope", "");
    expect(actions.setUserInputDraft).not.toHaveBeenCalledWith("99:scope:other", "にほん");
    expect(actions.setUserInputDraft).not.toHaveBeenCalledWith("99:scope", "にほん");

    setNativeInputValue(otherInput, "日本");
    otherInput.dispatchEvent(new Event("compositionend", { bubbles: true }));

    expect(actions.setUserInputDraft).toHaveBeenCalledWith("99:scope:other", "日本");
    expect(actions.setUserInputDraft).toHaveBeenCalledWith("99:scope", "日本");
  });

  it("renders pending approvals and Plan mode questions in the same request block", () => {
    const parent = document.createElement("div");
    const approval = pendingApproval();
    const input = pendingUserInput();

    renderPendingRequestNode(
      parent,
      [approval],
      [input],
      {
        values: new Map(),
        draftKey: (requestId, questionId) => `${String(requestId)}:${questionId}`,
        otherDraftKey: (requestId, questionId) => `${String(requestId)}:${questionId}:other`,
      },
      new Set(),
      pendingRequestActions(),
    );

    expect(parent.querySelectorAll(".codex-panel__pending-request-message")).toHaveLength(1);
    expect(parent.querySelectorAll(".codex-panel__pending-request-card")).toHaveLength(2);
    expect(parent.querySelectorAll(".codex-panel__pending-request-body")).toHaveLength(2);
    expect(parent.querySelector(".codex-panel__approval-body")).toBeNull();
    expect(parent.querySelector(".codex-panel__approval .codex-panel__pending-request-title")?.textContent).toBe("Permission approval");
    expect(parent.querySelector(".codex-panel__approval .codex-panel__pending-request-body")?.textContent).toContain("Need network");
    expect(parent.querySelector(".codex-panel__approval-details summary")?.textContent).toBe("Request details");
    expect(parent.querySelector(".codex-panel__user-input .codex-panel__pending-request-title")?.textContent).toBe("Codex needs input");
    expect([...parent.querySelectorAll(".codex-panel__pending-request-button")].map((button) => button.textContent)).toEqual([
      "Allow",
      "Allow session",
      "Deny",
      "Cancel",
      "Submit",
      "Cancel",
    ]);
  });

  it("focuses Plan mode input when pending requests ask for autofocus", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const input = pendingFreeformUserInput();

    try {
      renderPendingRequestNode(
        parent,
        [pendingApproval()],
        [input],
        {
          values: new Map(),
          draftKey: (requestId, questionId) => `${String(requestId)}:${questionId}`,
          otherDraftKey: (requestId, questionId) => `${String(requestId)}:${questionId}:other`,
        },
        new Set(),
        pendingRequestActions(),
        true,
      );

      expect(document.activeElement).toBe(parent.querySelector(".codex-panel__user-input-text"));
    } finally {
      unmountReactRoot(parent);
      parent.remove();
    }
  });

  it("focuses the selected Plan mode option before the other text field", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const input = pendingOtherUserInput();

    try {
      renderPendingRequestNode(
        parent,
        [],
        [input],
        {
          values: new Map(),
          draftKey: (requestId, questionId) => `${String(requestId)}:${questionId}`,
          otherDraftKey: (requestId, questionId) => `${String(requestId)}:${questionId}:other`,
        },
        new Set(),
        pendingRequestActions(),
        true,
      );

      expect(document.activeElement).toBe(parent.querySelector(".codex-panel__user-input-radio:checked"));
      expect(document.activeElement).not.toBe(parent.querySelector(".codex-panel__user-input-other-text"));
    } finally {
      unmountReactRoot(parent);
      parent.remove();
    }
  });

  it("focuses the approval action when pending approval asks for autofocus", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);

    try {
      renderPendingRequestNode(
        parent,
        [pendingApproval()],
        [],
        {
          values: new Map(),
          draftKey: (requestId, questionId) => `${String(requestId)}:${questionId}`,
          otherDraftKey: (requestId, questionId) => `${String(requestId)}:${questionId}:other`,
        },
        new Set(),
        pendingRequestActions(),
        true,
      );

      expect(document.activeElement).toBe(parent.querySelector(".codex-panel__pending-request-button.mod-cta"));
    } finally {
      unmountReactRoot(parent);
      parent.remove();
    }
  });

  it("renders command approval buttons from app-server available decisions", () => {
    const parent = document.createElement("div");
    const approval: PendingApproval = {
      requestId: 43,
      method: "item/commandExecution/requestApproval",
      params: {
        threadId: "thread",
        turnId: "turn",
        itemId: "command",
        startedAtMs: 1,
        reason: "Needs network",
        networkApprovalContext: { host: "registry.npmjs.org", protocol: "https" },
        command: null,
        cwd: "/vault",
        commandActions: [],
        proposedExecpolicyAmendment: null,
        proposedNetworkPolicyAmendments: [],
        availableDecisions: [
          { applyNetworkPolicyAmendment: { network_policy_amendment: { host: "registry.npmjs.org", action: "allow" } } },
          "decline",
        ],
      },
    };
    const resolveApproval = vi.fn();

    renderPendingRequestNode(
      parent,
      [approval],
      [],
      {
        values: new Map(),
        draftKey: (requestId, questionId) => `${String(requestId)}:${questionId}`,
        otherDraftKey: (requestId, questionId) => `${String(requestId)}:${questionId}:other`,
      },
      new Set(),
      pendingRequestActions({ resolveApproval }),
    );

    const buttons = [...parent.querySelectorAll<HTMLButtonElement>(".codex-panel__pending-request-button")];
    expect(buttons.map((button) => button.textContent)).toEqual(["Allow network rule", "Deny"]);
    const allowButton = buttons.at(0);
    if (!allowButton) throw new Error("Missing allow button");
    allowButton.click();
    expect(resolveApproval).toHaveBeenCalledWith(approval, {
      kind: "command-decision",
      decision: { applyNetworkPolicyAmendment: { network_policy_amendment: { host: "registry.npmjs.org", action: "allow" } } },
    });
  });

  it("renders submitted user input separately from approvals", () => {
    const block = messageStreamBlocks({
      activeThreadId: "thread",
      turnLifecycle: idleTurnLifecycle(),
      historyCursor: null,
      loadingHistory: false,
      displayItems: [
        {
          id: "user-input-submitted-1",
          kind: "userInputResult",
          role: "tool",
          text: "Input submitted for 1 question.",
          turnId: "turn",
          markdown: false,
          state: "completed",
          details: [{ title: "Question: Scope", rows: [{ key: "Answer", value: "Narrow" }] }],
        },
      ],
      openDetails: new Set(),
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
      renderTextWithWikiLinks: (parent, text) => parent.createDiv({ text }),
    })[0];

    const element = renderMessageBlockElement(block);

    expect(element.querySelector(".codex-panel__message-role")?.textContent).toBe("Input");
    expect(element.textContent).not.toContain("Approval");
    expect(element.querySelector("details summary")?.textContent).toBe("Question: Scope");
    expect(element.querySelector(".codex-panel__meta-grid")?.textContent).toContain("AnswerNarrow");
  });

  it("renders manual approval results with completion state and details", () => {
    const block = messageStreamBlocks({
      activeThreadId: "thread",
      turnLifecycle: idleTurnLifecycle(),
      historyCursor: null,
      loadingHistory: false,
      displayItems: [
        {
          id: "approval-1",
          kind: "approvalResult",
          role: "tool",
          text: "Allowed for this session: Need access",
          turnId: "turn",
          markdown: false,
          state: "completed",
          details: [
            {
              title: "Approval",
              rows: [
                { key: "status", value: "allowed for session" },
                { key: "scope", value: "session" },
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

    expect(element.classList.contains("codex-panel__message--approval-result")).toBe(true);
    expect(element.classList.contains("codex-panel__tool-result")).toBe(true);
    expect(element.classList.contains("codex-panel__execution--completed")).toBe(true);
    expect(element.querySelector(".codex-panel__message-content")).toBeNull();
    expect(element.querySelector(".codex-panel__tool-result-header")?.textContent).toBe("approval");
    expect(element.querySelector(".codex-panel__tool-summary")?.textContent).toBe("Allowed for this session: Need access");
    expect(element.querySelector("details summary")?.textContent).toBe("approval");
    expect(element.querySelector(".codex-panel__meta-grid")?.textContent).toContain("statusallowed for session");
    expect(element.querySelector(".codex-panel__meta-grid")?.textContent).toContain("scopesession");
  });

  it("renders auto-review summaries under the final assistant message", () => {
    const block = messageStreamBlocks({
      activeThreadId: "thread",
      turnLifecycle: idleTurnLifecycle(),
      historyCursor: null,
      loadingHistory: false,
      displayItems: [
        {
          id: "assistant-1",
          kind: "message",
          role: "assistant",
          text: "Done",
          turnId: "turn",
          markdown: true,
          autoReviewSummaries: ["Auto-review approved: npm test", "Auto-review approved: npm test"],
        },
      ],
      openDetails: new Set(),
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
      renderTextWithWikiLinks: (parent, text) => parent.createDiv({ text }),
    })[0];

    const element = renderMessageBlockElement(block);

    expect(element.querySelector(".codex-panel__auto-reviews summary")?.textContent).toBe("Auto-reviewed 2 requests");
    expect(element.querySelector(".codex-panel__auto-reviews")?.textContent).toContain("Auto-review approved: npm test");
  });

  it("adds pending requests to the bottom of message stream blocks", () => {
    const blocks = messageStreamBlocks({
      activeThreadId: "thread",
      turnLifecycle: idleTurnLifecycle(),
      historyCursor: null,
      loadingHistory: false,
      displayItems: [{ id: "a1", kind: "message", role: "assistant", text: "Done", markdown: true }],
      openDetails: new Set(),
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
      renderTextWithWikiLinks: (parent, text) => parent.createDiv({ text }),
      pendingRequestsSignature: "request:1",
      renderPendingRequests: () => "Request",
    });

    expect(blocks.map((block) => block.key)).toEqual(["item:a1", "pending-requests"]);
    expect(expectPresent(blocks[1]).node).not.toBeUndefined();
  });

  it("keeps pending request React events mounted in the message stream host", () => {
    const parent = document.createElement("div");
    const approval = pendingApproval();
    const resolveApproval = vi.fn();

    renderMessageStreamBlocks(
      parent,
      messageStreamBlocks({
        activeThreadId: "thread",
        turnLifecycle: idleTurnLifecycle(),
        historyCursor: null,
        loadingHistory: false,
        displayItems: [{ id: "a1", kind: "message", role: "assistant", text: "Waiting", markdown: true }],
        openDetails: new Set(),
        loadOlderTurns: vi.fn(),
        renderMarkdown: (element, text) => element.createDiv({ text }),
        renderTextWithWikiLinks: (element, text) => element.createDiv({ text }),
        pendingRequestsSignature: "approval:1",
        renderPendingRequests: () =>
          pendingRequestMessageNode(
            [approval],
            [],
            {
              values: new Map(),
              draftKey: (requestId, questionId) => `${String(requestId)}:${questionId}`,
              otherDraftKey: (requestId, questionId) => `${String(requestId)}:${questionId}:other`,
            },
            new Set(),
            pendingRequestActions({ resolveApproval }),
          ),
      }),
    );

    parent.querySelector<HTMLButtonElement>(".codex-panel__pending-request-button")?.click();

    expect(resolveApproval).toHaveBeenCalledWith(approval, "accept");
    unmountReactRoot(parent);
  });

  it("removes pending request blocks when the signature clears", () => {
    const parent = document.createElement("div");
    const baseContext = {
      activeThreadId: "thread",
      turnLifecycle: idleTurnLifecycle(),
      historyCursor: null,
      loadingHistory: false,
      displayItems: [{ id: "a1", kind: "message", role: "assistant", text: "Done", markdown: true }] satisfies DisplayItem[],
      openDetails: new Set<string>(),
      loadOlderTurns: vi.fn(),
      renderMarkdown: (element: HTMLElement, text: string) => element.createDiv({ text }),
      renderTextWithWikiLinks: (element: HTMLElement, text: string) => element.createDiv({ text }),
    };

    renderMessageStreamBlocks(
      parent,
      messageStreamBlocks({
        ...baseContext,
        pendingRequestsSignature: "request:1",
        renderPendingRequests: () => <button type="button">Resolve</button>,
      }),
    );
    expect(parent.querySelector('[data-codex-panel-block-key="pending-requests"]')).not.toBeNull();

    renderMessageStreamBlocks(parent, messageStreamBlocks(baseContext));

    expect(parent.querySelector('[data-codex-panel-block-key="pending-requests"]')).toBeNull();
    expect(parent.querySelector('[data-codex-panel-block-key="item:a1"]')).not.toBeNull();
    unmountReactRoot(parent);
  });
});

function pendingUserInput(): PendingUserInput {
  return {
    requestId: 99,
    method: "item/tool/requestUserInput",
    params: {
      threadId: "thread",
      turnId: "turn",
      itemId: "input",
      questions: [
        {
          id: "scope",
          header: "Scope",
          question: "How broad?",
          isOther: false,
          isSecret: false,
          options: [{ label: "Narrow", description: "Small change" }],
        },
      ],
    },
  };
}

function pendingOtherUserInput(): PendingUserInput {
  const input = pendingUserInput();
  return {
    ...input,
    params: {
      ...input.params,
      questions: [
        {
          ...expectPresent(input.params.questions[0]),
          isOther: true,
          options: [{ label: "Narrow", description: "Small change" }],
        },
      ],
    },
  };
}

function pendingFreeformUserInput(): PendingUserInput {
  const input = pendingUserInput();
  return {
    ...input,
    params: {
      ...input.params,
      questions: [
        {
          ...expectPresent(input.params.questions[0]),
          options: null,
        },
      ],
    },
  };
}

function pendingApproval(): PendingApproval {
  return {
    requestId: 42,
    method: "item/permissions/requestApproval",
    params: {
      threadId: "thread",
      turnId: "turn",
      itemId: "permission",
      startedAtMs: 1,
      cwd: "/vault",
      reason: "Need network",
      permissions: { network: { enabled: true }, fileSystem: null },
    },
  };
}
