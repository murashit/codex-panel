// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PendingApproval } from "../src/approvals/model";
import type { PendingUserInput } from "../src/user-input/model";
import {
  renderComposerShell,
  renderComposerSuggestions,
  scrollComposerSuggestionIntoView,
  syncComposerControls,
  syncComposerHeight,
} from "../src/view/composer";
import { renderPendingRequestMessage } from "../src/view/pending-request-message";
import { renderToolbar, toolbarSignature, type ToolbarViewModel } from "../src/view/toolbar";
import { displayItemSignature } from "../src/display/signature";
import { messageRenderBlocks } from "../src/view/message-stream";
import { displayDiffLines, persistedTurnDiffViewState, renderTurnDiffView } from "../src/view/turn-diff";

declare global {
  function createDiv(options?: { cls?: string; text?: string; attr?: Record<string, string> }): HTMLDivElement;

  interface HTMLElement {
    addClass(className: string): void;
    createDiv(options?: { cls?: string; text?: string; attr?: Record<string, string> }): HTMLDivElement;
    createEl<K extends keyof HTMLElementTagNameMap>(
      tag: K,
      options?: { cls?: string; text?: string; attr?: Record<string, string> },
    ): HTMLElementTagNameMap[K];
    createSpan(options?: { cls?: string; text?: string; attr?: Record<string, string> }): HTMLSpanElement;
    empty(): void;
    hide(): void;
    setCssProps(props: Record<string, string>): void;
    setAttr(name: string, value: string): void;
    show(): void;
  }
}

beforeEach(() => {
  HTMLElement.prototype.addClass = function addClass(this: HTMLElement, className: string): void {
    this.classList.add(...className.split(/\s+/).filter(Boolean));
  };
  HTMLElement.prototype.createEl = function createEl<K extends keyof HTMLElementTagNameMap>(
    this: HTMLElement,
    tag: K,
    options: { cls?: string; text?: string; attr?: Record<string, string> } = {},
  ): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);
    if (options.cls) element.className = options.cls;
    if (options.text) element.textContent = options.text;
    for (const [key, value] of Object.entries(options.attr ?? {})) {
      element.setAttribute(key, value);
    }
    this.appendChild(element);
    return element;
  };
  HTMLElement.prototype.createDiv = function createDiv(
    this: HTMLElement,
    options: { cls?: string; text?: string; attr?: Record<string, string> } = {},
  ): HTMLDivElement {
    return this.createEl("div", options);
  };
  HTMLElement.prototype.createSpan = function createSpan(
    this: HTMLElement,
    options: { cls?: string; text?: string; attr?: Record<string, string> } = {},
  ): HTMLSpanElement {
    return this.createEl("span", options);
  };
  HTMLElement.prototype.empty = function empty(this: HTMLElement): void {
    this.replaceChildren();
  };
  HTMLElement.prototype.hide = function hide(this: HTMLElement): void {
    this.style.display = "none";
  };
  HTMLElement.prototype.show = function show(this: HTMLElement): void {
    this.style.display = "";
  };
  HTMLElement.prototype.setAttr = function setAttr(this: HTMLElement, name: string, value: string): void {
    this.setAttribute(name, value);
  };
  HTMLElement.prototype.setCssProps = function setCssProps(this: HTMLElement, props: Record<string, string>): void {
    for (const [key, value] of Object.entries(props)) {
      this.style.setProperty(key, value);
    }
  };
  HTMLElement.prototype.scrollIntoView = vi.fn();
  globalThis.createDiv = ((options: { cls?: string; text?: string; attr?: Record<string, string> } = {}) =>
    document.body.createDiv(options)) as typeof globalThis.createDiv;
});

function topLevelDetailsSummaries(element: HTMLElement): Array<string | null> {
  const candidates = [element, ...element.children];
  return candidates
    .filter((child): child is HTMLDetailsElement => child instanceof HTMLDetailsElement)
    .map((details) => details.querySelector("summary")?.textContent ?? null);
}

function composerSuggestionScrollFixture(metrics: { clientHeight: number; optionHeight: number; optionTop: number; scrollTop: number }): {
  container: HTMLElement;
  option: HTMLElement;
} {
  const container = document.createElement("div");
  const option = container.createDiv();

  Object.defineProperty(container, "clientHeight", { value: metrics.clientHeight, configurable: true });
  Object.defineProperty(option, "offsetHeight", { value: metrics.optionHeight, configurable: true });
  Object.defineProperty(option, "offsetTop", { value: metrics.optionTop, configurable: true });
  container.scrollTop = metrics.scrollTop;

  return { container, option };
}

describe("view renderers", () => {
  it("invalidates message blocks when markdown rendering mode changes", () => {
    const context = { busy: false, activeTurnId: null, displayItems: [] };
    const streamed = {
      id: "a1",
      itemId: "a1",
      kind: "message",
      role: "assistant",
      text: "**done**",
      markdown: false,
    } as const;
    const completed = { ...streamed, markdown: true };

    expect(displayItemSignature(streamed, context)).not.toBe(displayItemSignature(completed, context));
  });

  it("invalidates path summary tool blocks when the workspace root changes", () => {
    const item = {
      id: "tool-path",
      kind: "tool",
      role: "tool",
      text: "/vault/project/assets/image.png",
      toolLabel: "imageView",
      summaryPath: true,
    } as const;
    const baseContext = { busy: false, activeTurnId: null, displayItems: [item] };

    expect(displayItemSignature(item, { ...baseContext, workspaceRoot: "/vault" })).not.toBe(
      displayItemSignature(item, { ...baseContext, workspaceRoot: "/vault/project" }),
    );
  });

  it("does not invalidate generic tool blocks when only the workspace root changes", () => {
    const item = {
      id: "tool",
      kind: "tool",
      role: "tool",
      text: "/vault/project",
      toolLabel: "example.tool",
    } as const;
    const baseContext = { busy: false, activeTurnId: null, displayItems: [item] };

    expect(displayItemSignature(item, { ...baseContext, workspaceRoot: "/vault" })).toBe(
      displayItemSignature(item, { ...baseContext, workspaceRoot: "/vault/project" }),
    );
  });

  it("renders review result items as compact auto-review tool rows", () => {
    const block = messageRenderBlocks({
      activeThreadId: "thread",
      activeTurnId: null,
      historyCursor: null,
      loadingHistory: false,
      busy: false,
      displayItems: [{ id: "review-1", kind: "reviewResult", role: "tool", text: "Auto-review denied this command.", markdown: false }],
      openDetails: new Set(),
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
      renderTextWithWikiLinks: (parent, text) => parent.createDiv({ text }),
    })[0];

    const element = block.render();

    expect(element.classList.contains("codex-panel__message--review-result")).toBe(true);
    expect(element.classList.contains("codex-panel__tool-result--plain")).toBe(true);
    expect(element.querySelector(".codex-panel__message-role")?.textContent).toBe("auto-review");
    expect(element.textContent).toContain("Auto-review denied this command.");
    expect(element.querySelector("details")).toBeNull();
  });

  it("renders review result details inside one auto-review details block", () => {
    const block = messageRenderBlocks({
      activeThreadId: "thread",
      activeTurnId: "turn",
      historyCursor: null,
      loadingHistory: false,
      busy: false,
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
                { key: "files", value: "src/display/tool-view.ts\nsrc/view/message-stream.ts" },
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

    const element = block.render();

    expect(element.classList.contains("codex-panel__execution--completed")).toBe(true);
    expect(topLevelDetailsSummaries(element)).toEqual(["auto-review"]);
    expect([...element.querySelectorAll("details summary")].map((summary) => summary.textContent)).toEqual(["auto-review"]);
    expect(element.textContent).not.toContain("Details");
    expect(element.textContent).not.toContain("▶Review");
    expect(element.querySelector(".codex-panel__meta-grid")?.textContent).toContain("statusapproved");
    expect(element.querySelector(".codex-panel__meta-grid")?.textContent).toContain("actionapply patch");
    expect(element.querySelector(".codex-panel__meta-grid")?.textContent).toContain(
      "filessrc/display/tool-view.ts\nsrc/view/message-stream.ts",
    );
    expect([...element.querySelectorAll(".codex-panel__output-title")].map((title) => title.textContent)).toEqual([]);
  });

  it("renders rollback action only for the eligible user message", () => {
    const onRollbackItem = vi.fn();
    const items = [
      { id: "u1", kind: "message", role: "user", text: "older", turnId: "turn-1", markdown: true },
      { id: "a1", kind: "message", role: "assistant", text: "older answer", turnId: "turn-1", markdown: true },
      { id: "u2", kind: "message", role: "user", text: "latest", turnId: "turn-2", markdown: true },
    ] as const;
    const blocks = messageRenderBlocks({
      activeThreadId: "thread",
      activeTurnId: null,
      historyCursor: null,
      loadingHistory: false,
      busy: false,
      displayItems: [...items],
      openDetails: new Set(),
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
      renderTextWithWikiLinks: (parent, text) => parent.createDiv({ text }),
      canRollbackItem: (item) => item.id === "u2",
      onRollbackItem,
    });

    const rendered = blocks.map((block) => block.render());

    expect(rendered[0].querySelector(".codex-panel__rollback-turn")).toBeNull();
    expect(rendered[1].querySelector(".codex-panel__rollback-turn")).toBeNull();
    const button = rendered[2].querySelector<HTMLButtonElement>(".codex-panel__rollback-turn");
    expect(button?.getAttribute("aria-label")).toBe("Rollback last turn");
    button?.click();
    expect(onRollbackItem).toHaveBeenCalledWith(expect.objectContaining({ id: "u2" }));
  });

  it("renders copy actions for copyable messages", () => {
    const copyText = vi.fn();
    const blocks = messageRenderBlocks({
      activeThreadId: "thread",
      activeTurnId: null,
      historyCursor: null,
      loadingHistory: false,
      busy: false,
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

    const rendered = blocks.map((block) => block.render());
    const userButton = rendered[0].querySelector<HTMLButtonElement>(".codex-panel__copy-message");
    const assistantButton = rendered[1].querySelector<HTMLButtonElement>(".codex-panel__copy-message");

    expect(userButton?.getAttribute("aria-label")).toBe("Copy message");
    expect(assistantButton?.getAttribute("aria-label")).toBe("Copy message");
    userButton?.click();
    assistantButton?.click();
    expect(copyText).toHaveBeenNthCalledWith(1, "**user**");
    expect(copyText).toHaveBeenNthCalledWith(2, "# Answer");
  });

  it("does not render copy actions for tool items", () => {
    const block = messageRenderBlocks({
      activeThreadId: "thread",
      activeTurnId: "turn",
      historyCursor: null,
      loadingHistory: false,
      busy: false,
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

    expect(block.render().querySelector(".codex-panel__copy-message")).toBeNull();
  });

  it("renders copy and rollback actions together when both apply", () => {
    const copyText = vi.fn();
    const onRollbackItem = vi.fn();
    const block = messageRenderBlocks({
      activeThreadId: "thread",
      activeTurnId: null,
      historyCursor: null,
      loadingHistory: false,
      busy: false,
      displayItems: [{ id: "u1", kind: "message", role: "user", text: "latest", copyText: "latest", turnId: "turn-1", markdown: true }],
      openDetails: new Set(),
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
      renderTextWithWikiLinks: (parent, text) => parent.createDiv({ text }),
      copyText,
      canRollbackItem: () => true,
      onRollbackItem,
    })[0];

    const element = block.render();
    element.querySelector<HTMLButtonElement>(".codex-panel__copy-message")?.click();
    element.querySelector<HTMLButtonElement>(".codex-panel__rollback-turn")?.click();

    expect(copyText).toHaveBeenCalledWith("latest");
    expect(onRollbackItem).toHaveBeenCalledWith(expect.objectContaining({ id: "u1" }));
  });

  it("does not render rollback action when no item is eligible", () => {
    const block = messageRenderBlocks({
      activeThreadId: "thread",
      activeTurnId: null,
      historyCursor: null,
      loadingHistory: false,
      busy: true,
      displayItems: [{ id: "u1", kind: "message", role: "user", text: "running", turnId: "turn-1", markdown: true }],
      openDetails: new Set(),
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
      renderTextWithWikiLinks: (parent, text) => parent.createDiv({ text }),
      canRollbackItem: () => false,
      onRollbackItem: vi.fn(),
    })[0];

    expect(block.render().querySelector(".codex-panel__rollback-turn")).toBeNull();
  });

  it("renders command items as a compact summary with output behind details", () => {
    const block = messageRenderBlocks({
      activeThreadId: "thread",
      activeTurnId: "turn",
      historyCursor: null,
      loadingHistory: false,
      busy: true,
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

    const element = block.render();

    expect(element.querySelector(".codex-panel__tool-summary")?.textContent).toBe("npm run check (exit 1)");
    expect(element.querySelector(".codex-panel__tool-summary")?.getAttribute("title")).toBe("npm run check (exit 1)");
    expect(topLevelDetailsSummaries(element)).toEqual(["command"]);
    expect([...element.querySelectorAll("details summary")].map((summary) => summary.textContent)).toEqual(["command"]);
    expect(element.textContent).not.toContain("Details");
    expect([...element.querySelectorAll(".codex-panel__output-title")].map((title) => title.textContent)).toEqual(["Output"]);
    expect(element.querySelector(".codex-panel__output pre")?.textContent).toBe("stderr details");
    expect(element.querySelector("details")?.hasAttribute("open")).toBe(false);
  });

  it("uses read as the command header for parsed file reads", () => {
    const block = messageRenderBlocks({
      activeThreadId: "thread",
      activeTurnId: "turn",
      historyCursor: null,
      loadingHistory: false,
      busy: true,
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

    const element = block.render();

    expect([...element.querySelectorAll("details summary")].map((summary) => summary.textContent)).toEqual(["read"]);
  });

  it("renders file diffs inside a single file change details block", () => {
    const block = messageRenderBlocks({
      activeThreadId: "thread",
      activeTurnId: "turn",
      historyCursor: null,
      loadingHistory: false,
      busy: true,
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

    const element = block.render();

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
    const blocks = messageRenderBlocks({
      activeThreadId: "thread",
      activeTurnId: null,
      historyCursor: null,
      loadingHistory: false,
      busy: false,
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

    const assistant = blocks.find((block) => block.key === "item:a1")?.render();
    const button = assistant?.querySelector<HTMLButtonElement>(".codex-panel__open-turn-diff");

    expect(assistant?.querySelector(".codex-panel__edited-files")?.textContent).toContain("Edited 1 file");
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

  it("does not render the open diff action without aggregated turn diff", () => {
    const blocks = messageRenderBlocks({
      activeThreadId: "thread",
      activeTurnId: null,
      historyCursor: null,
      loadingHistory: false,
      busy: false,
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

    const assistant = blocks.find((block) => block.key === "item:a1")?.render();

    expect(assistant?.querySelector(".codex-panel__edited-files")?.textContent).toContain("Edited 1 file");
    expect(assistant?.querySelector(".codex-panel__open-turn-diff")).toBeNull();
  });

  it("renders the turn diff view with classified unified diff lines", () => {
    const parent = document.createElement("div");
    const copyDiff = vi.fn();

    renderTurnDiffView(
      parent,
      {
        threadId: "019e061e-0046-7653-a362-86de9a47cb5c",
        turnId: "019e061f-0046-7653-a362-86de9a47cb5c",
        cwd: "/vault/project",
        files: ["src/main.ts"],
        diff: "diff --git a/src/main.ts b/src/main.ts\n--- a/src/main.ts\n+++ b/src/main.ts\n@@\n-old\n+new\n context",
      },
      { copyDiff },
    );

    expect(parent.querySelector(".codex-panel-turn-diff__title")?.textContent).toBe("Turn diff");
    expect(parent.querySelector(".codex-panel-turn-diff__meta")?.textContent).toContain("019e061e");
    expect(parent.querySelector(".codex-panel-turn-diff__files summary")?.textContent).toBe("Changed files");
    expect(parent.querySelector(".codex-panel-turn-diff__files")?.textContent).toContain("src/main.ts");
    expect(parent.querySelector(".codex-panel__diff-line--file")?.textContent).toBe("src/main.ts");
    expect(parent.textContent).not.toContain("diff --git");
    expect(parent.textContent).not.toContain("+++ b/src/main.ts");
    expect(parent.querySelectorAll(".codex-panel__diff-line--hunk")).toHaveLength(1);
    expect(parent.querySelectorAll(".codex-panel__diff-line--removed")).toHaveLength(1);
    expect(parent.querySelectorAll(".codex-panel__diff-line--added")).toHaveLength(1);
    parent.querySelector<HTMLButtonElement>(".codex-panel-turn-diff__copy")?.click();
    expect(copyDiff).toHaveBeenCalled();
  });

  it("keeps unified diff text out of persisted turn diff view state", () => {
    const persisted = persistedTurnDiffViewState({
      threadId: "thread",
      turnId: "turn",
      cwd: "/vault/project",
      files: ["src/main.ts"],
      diff: "@@\n-old\n+new",
    });

    expect(persisted).toEqual({
      threadId: "thread",
      turnId: "turn",
      cwd: "/vault/project",
      files: ["src/main.ts"],
    });
    expect(persisted).not.toHaveProperty("diff");
  });

  it("renders restored turn diff metadata without unavailable diff text", () => {
    const parent = document.createElement("div");

    renderTurnDiffView(parent, null, {}, { threadId: "thread", turnId: "turn", cwd: "/vault/project", files: ["src/main.ts"] });

    expect(parent.querySelector(".codex-panel-turn-diff__meta")?.textContent).toContain("thread / turn");
    expect(parent.textContent).toContain("Turn diff is no longer available.");
    expect(parent.querySelector(".codex-panel-turn-diff__copy")).toBeNull();
    expect(parent.querySelector(".codex-panel-turn-diff__diff")).toBeNull();
  });

  it("simplifies git diff file headers for turn diff display", () => {
    expect(
      displayDiffLines(
        "diff --git a/days/2026-05-16.md b/days/2026-05-16.md\nindex 111..222\n--- a/days/2026-05-16.md\n+++ b/days/2026-05-16.md\n@@\n-old\n+new",
      ),
    ).toEqual([{ text: "days/2026-05-16.md", kind: "file" }, { text: "@@" }, { text: "-old" }, { text: "+new" }]);
  });

  it("keeps added-file diffs readable after simplifying headers", () => {
    expect(
      displayDiffLines(
        "diff --git a/new-note.md b/new-note.md\nnew file mode 100644\nindex 0000000..1111111\n--- /dev/null\n+++ b/new-note.md\n@@\n+hello",
      ),
    ).toEqual([{ text: "new-note.md", kind: "file" }, { text: "new file mode 100644" }, { text: "@@" }, { text: "+hello" }]);
  });

  it("keeps body lines that look like file markers after the hunk starts", () => {
    expect(
      displayDiffLines(
        "diff --git a/note.md b/note.md\nindex 111..222\n--- a/note.md\n+++ b/note.md\n@@\n+++ frontmatter\n--- removed marker",
      ),
    ).toEqual([{ text: "note.md", kind: "file" }, { text: "@@" }, { text: "+++ frontmatter" }, { text: "--- removed marker" }]);
  });

  it("renders generic tool details as visible sections inside one details block", () => {
    const block = messageRenderBlocks({
      activeThreadId: "thread",
      activeTurnId: "turn",
      historyCursor: null,
      loadingHistory: false,
      busy: true,
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

    const element = block.render();

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
    const block = messageRenderBlocks({
      activeThreadId: "thread",
      activeTurnId: "turn",
      historyCursor: null,
      loadingHistory: false,
      busy: true,
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

    const element = block.render();

    expect(element.classList.contains("is-open")).toBe(true);
    expect(element.querySelector("details")?.hasAttribute("open")).toBe(true);
    expect(topLevelDetailsSummaries(element)).toEqual(["command"]);
    expect(element.querySelector(":scope > .codex-panel__tool-summary")?.textContent).toBe("npm run check");
  });

  it("renders generic tools without details as two compact rows", () => {
    const block = messageRenderBlocks({
      activeThreadId: "thread",
      activeTurnId: "turn",
      historyCursor: null,
      loadingHistory: false,
      busy: true,
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

    const element = block.render();

    expect(element.classList.contains("codex-panel__tool-result--plain")).toBe(true);
    expect(element.querySelector(".codex-panel__tool-result-header")?.textContent).toBe("web search");
    expect(element.querySelector(".codex-panel__tool-summary")?.textContent).toBe("https://example.com");
  });

  it("renders path summary tools relative to the workspace root", () => {
    const block = messageRenderBlocks({
      activeThreadId: "thread",
      activeTurnId: "turn",
      historyCursor: null,
      loadingHistory: false,
      busy: true,
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

    const element = block.render();

    expect(element.querySelector(".codex-panel__tool-summary")?.textContent).toBe("assets/image.png");
    expect(element.querySelector(".codex-panel__tool-summary")?.getAttribute("title")).toBe("assets/image.png");
  });

  it("keeps path summary tools absolute outside the workspace root", () => {
    const block = messageRenderBlocks({
      activeThreadId: "thread",
      activeTurnId: "turn",
      historyCursor: null,
      loadingHistory: false,
      busy: true,
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

    const element = block.render();

    expect(element.querySelector(".codex-panel__tool-summary")?.textContent).toBe("/tmp/image.png");
  });

  it("does not treat generic tool summaries as paths without an explicit marker", () => {
    const block = messageRenderBlocks({
      activeThreadId: "thread",
      activeTurnId: "turn",
      historyCursor: null,
      loadingHistory: false,
      busy: true,
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

    const element = block.render();

    expect(element.querySelector(".codex-panel__tool-summary")?.textContent).toBe("/vault/project");
  });

  it("renders hook metadata as rows inside one details block", () => {
    const block = messageRenderBlocks({
      activeThreadId: "thread",
      activeTurnId: "turn",
      historyCursor: null,
      loadingHistory: false,
      busy: true,
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

    const element = block.render();

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

  it("renders task progress items as a dedicated task list", () => {
    const block = messageRenderBlocks({
      activeThreadId: "thread",
      activeTurnId: "turn",
      historyCursor: null,
      loadingHistory: false,
      busy: true,
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

    const element = block.render();

    expect(element.classList.contains("codex-panel__work-message")).toBe(true);
    expect(element.classList.contains("codex-panel__task-progress")).toBe(true);
    expect(element.querySelector(".codex-panel__message-role")?.textContent).toBe("tasks");
    expect(element.textContent).toContain("[x]Inspect code");
    expect(element.textContent).toContain("[>]Patch UI");
  });

  it("renders agent activity with target state and prompt details", () => {
    const block = messageRenderBlocks({
      activeThreadId: "thread",
      activeTurnId: "turn",
      historyCursor: null,
      loadingHistory: false,
      busy: true,
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

    const element = block.render();

    expect(element.classList.contains("codex-panel__work-message")).toBe(true);
    expect(element.classList.contains("codex-panel__agent-activity")).toBe(true);
    expect(element.querySelector(".codex-panel__message-role")?.textContent).toBe("agent");
    expect(element.querySelector(".codex-panel__tool-summary")?.textContent).toBe("spawn child (completed)");
    expect(element.textContent).toContain("child");
    expect(element.textContent).toContain("completed: Done");
    expect([...element.querySelectorAll("details summary")].map((summary) => summary.textContent)).toEqual(["Details", "Prompt"]);
  });

  it("collapses long agent output away from the agent status row", () => {
    const longMessage = `Done\n${"a".repeat(180)}`;
    const threadId = "019e061e-0046-7653-a362-86de9a47cb5c";
    const onDetailsToggle = vi.fn();
    const block = messageRenderBlocks({
      activeThreadId: "thread",
      activeTurnId: "turn",
      historyCursor: null,
      loadingHistory: false,
      busy: true,
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

    const element = block.render();

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
    const blocks = messageRenderBlocks({
      activeThreadId: "thread",
      activeTurnId: "turn",
      historyCursor: null,
      loadingHistory: false,
      busy: true,
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

    const summary = blocks.at(-1)?.render();

    expect(summary?.classList.contains("codex-panel__work-message")).toBe(true);
    expect(summary?.classList.contains("codex-panel__agent-summary")).toBe(true);
    expect(summary?.textContent).toContain("agents");
    expect(summary?.textContent).toContain("Agents 1 running, 1 done");
    expect(summary?.textContent).toContain("runningrunning: Inspecting renderer");
    expect(summary?.textContent).toContain("donecompleted");
  });

  it("hides the live agent summary once all subagents are complete", () => {
    const blocks = messageRenderBlocks({
      activeThreadId: "thread",
      activeTurnId: "turn",
      historyCursor: null,
      loadingHistory: false,
      busy: true,
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
    const blocks = messageRenderBlocks({
      activeThreadId: "thread",
      activeTurnId: "turn",
      historyCursor: null,
      loadingHistory: false,
      busy: true,
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

    const summary = blocks.at(-1)?.render();

    expect(summary?.classList.contains("codex-panel__execution--failed")).toBe(true);
    expect(summary?.textContent).toContain("Agents 1 failed, 1 running");
    expect(summary?.textContent).toContain("failederrored: Failed");
  });

  it("renders toolbar controls as buttons and signatures include live status/catalog state", () => {
    const parent = document.createElement("div");
    const toggleHistory = vi.fn();
    const baseModel = toolbarModel();

    renderToolbar(parent, baseModel, toolbarActions({ toggleHistory }));

    const statusButton = parent.querySelector(".codex-panel__status-dot");
    expect(statusButton?.tagName).toBe("BUTTON");
    expect(statusButton?.getAttribute("role")).toBeNull();
    parent.querySelector<HTMLButtonElement>(".codex-panel__history-toggle")?.click();
    expect(toggleHistory).toHaveBeenCalled();

    expect(toolbarSignature(baseModel)).not.toBe(toolbarSignature({ ...baseModel, status: "Turn running..." }));
    expect(toolbarSignature(baseModel)).not.toBe(
      toolbarSignature({ ...baseModel, effortChoices: [...baseModel.effortChoices, { label: "xhigh", onClick: vi.fn() }] }),
    );
    expect(toolbarSignature(baseModel)).not.toBe(
      toolbarSignature({ ...baseModel, diagnostics: [{ label: "compatibility", value: "model/list failed", level: "error" }] }),
    );
    expect(toolbarSignature(baseModel)).not.toBe(
      toolbarSignature({
        ...baseModel,
        rateLimit: {
          title: "Codex: 5h 42%",
          level: "ok",
          rows: [{ label: "5h", value: "42%", resetLabel: "reset in 2h", title: "Codex 5h: 42% used.", percent: 42, level: "ok" }],
        },
      }),
    );
  });

  it("renders context as a compact meter and Codex limits only in the status menu", () => {
    const parent = document.createElement("div");

    renderToolbar(
      parent,
      toolbarModel({
        statusPanelOpen: true,
        openPanel: "status",
        context: { label: "12%", title: "Context: 12%.", percent: 12, level: "ok" },
        rateLimit: {
          title: "Codex: 5h 42%, 1w 21%",
          level: "ok",
          rows: [
            {
              label: "5h",
              value: "42%",
              resetLabel: "reset in 2h",
              title: "Codex 5h: 42% used.",
              percent: 42,
              level: "ok",
            },
            {
              label: "1w",
              value: "21%",
              resetLabel: "reset in 3d 4h",
              title: "Codex 1w: 21% used.",
              percent: 21,
              level: "ok",
            },
          ],
        },
      }),
      toolbarActions(),
    );

    expect(parent.querySelector(".codex-panel__context-compact")?.textContent).toContain("12%");
    expect(parent.querySelector(".codex-panel__limit-compact")).toBeNull();
    expect(parent.querySelector(".codex-panel__limit-panel")?.textContent).toContain("5h");
    expect(parent.querySelector(".codex-panel__limit-panel")?.textContent).toContain("42%");
    expect(parent.querySelector(".codex-panel__limit-panel")?.textContent).toContain("reset in 2h");
    expect(parent.querySelector(".codex-panel__limit-panel")?.textContent).toContain("1w");
    expect(parent.querySelector(".codex-panel__limit-panel")?.textContent).toContain("21%");
    expect(parent.querySelector(".codex-panel__limit-panel")?.textContent).toContain("reset in 3d 4h");
  });

  it("renders connection diagnostics in the status menu", () => {
    const parent = document.createElement("div");

    renderToolbar(
      parent,
      toolbarModel({
        statusPanelOpen: true,
        openPanel: "status",
        diagnostics: [
          { label: "running app-server", value: "codex-cli/1.2.3" },
          { label: "compatibility", value: "model/list failed", level: "error" },
        ],
      }),
      toolbarActions(),
    );

    expect(parent.querySelector(".codex-panel__connection-diagnostics-title")?.textContent).toBe("Connection diagnostics");
    expect(parent.textContent).toContain("Effective Codex config");
    expect(parent.textContent).toContain("codex-cli/1.2.3");
    expect(parent.querySelector(".codex-panel__connection-diagnostics-row--error")?.textContent).toContain("model/list failed");
  });

  it("renders effective config inside the status menu without a separate toggle", () => {
    const parent = document.createElement("div");

    renderToolbar(
      parent,
      toolbarModel({
        statusPanelOpen: true,
        openPanel: "status",
        configSections: [{ title: "Runtime", rows: [{ key: "model", value: "gpt-5.5" }] }],
      }),
      toolbarActions(),
    );

    expect(parent.querySelector(".codex-panel__slot--config")).toBeNull();
    expect(parent.querySelector(".codex-panel__toolbar-panel .codex-panel__config")?.textContent).toContain("Effective Codex config");
    expect(parent.textContent).not.toContain("Show effective config");
    expect(parent.textContent).not.toContain("Hide effective config");
    expect(parent.textContent).toContain("gpt-5.5");
  });

  it("renders chat history rename actions and an inline rename editor", () => {
    const parent = document.createElement("div");
    const startRenameThread = vi.fn();
    const updateRenameDraft = vi.fn();
    const saveRenameThread = vi.fn();
    const cancelRenameThread = vi.fn();
    const autoNameThread = vi.fn();

    renderToolbar(
      parent,
      toolbarModel({
        historyOpen: true,
        openPanel: "history",
        threads: [
          { title: "Thread", threadId: "thread", selected: true, disabled: false, canArchive: true, rename: null },
          {
            title: "Editing",
            threadId: "editing",
            selected: false,
            disabled: false,
            canArchive: true,
            rename: { draft: "Draft title", generating: false },
          },
        ],
      }),
      toolbarActions({ startRenameThread, updateRenameDraft, saveRenameThread, cancelRenameThread, autoNameThread }),
    );

    parent.querySelector<HTMLButtonElement>('[aria-label="Rename thread"]')?.click();
    expect(startRenameThread).toHaveBeenCalledWith("thread");

    const input = parent.querySelector<HTMLInputElement>(".codex-panel__thread-rename-input");
    expect(input?.value).toBe("Draft title");
    input!.value = "New title";
    input!.dispatchEvent(new Event("input", { bubbles: true }));
    expect(updateRenameDraft).toHaveBeenCalledWith("editing", "New title");

    parent.querySelector<HTMLButtonElement>('[aria-label="Save thread name"]')?.click();
    expect(saveRenameThread).toHaveBeenCalledWith("editing", "New title");
    parent.querySelector<HTMLButtonElement>('[aria-label="Cancel rename"]')?.click();
    expect(cancelRenameThread).toHaveBeenCalledWith("editing");
    parent.querySelector<HTMLButtonElement>('[aria-label="Auto-name thread"]')?.click();
    expect(autoNameThread).toHaveBeenCalledWith("editing");
  });

  it("renders auto-name loading without disabling the rename draft field", () => {
    const parent = document.createElement("div");

    renderToolbar(
      parent,
      toolbarModel({
        historyOpen: true,
        openPanel: "history",
        threads: [
          {
            title: "Editing",
            threadId: "editing",
            selected: false,
            disabled: false,
            canArchive: true,
            rename: { draft: "Draft title", generating: true },
          },
        ],
      }),
      toolbarActions(),
    );

    expect(parent.querySelector<HTMLInputElement>(".codex-panel__thread-rename-input")?.disabled).toBe(false);
    expect(parent.querySelector<HTMLButtonElement>('[aria-label="Save thread name"]')?.disabled).toBe(true);
    expect(parent.querySelector<HTMLButtonElement>('[aria-label="Auto-name thread"]')?.disabled).toBe(true);
    expect(parent.querySelector<HTMLButtonElement>('[aria-label="Cancel rename"]')?.disabled).toBe(false);
  });

  it("renders pending requests as one message-stream block and keeps user input drafts live", () => {
    const parent = document.createElement("div");
    const drafts = new Map<string, string>();
    const resolveUserInput = vi.fn();
    const input = pendingUserInput();

    renderPendingRequestMessage(
      parent,
      [],
      [input],
      {
        values: drafts,
        draftKey: (requestId, questionId) => `${String(requestId)}:${questionId}`,
        otherDraftKey: (requestId, questionId) => `${String(requestId)}:${questionId}:other`,
      },
      new Set(),
      { resolveApproval: vi.fn(), resolveUserInput, cancelUserInput: vi.fn() },
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

  it("renders pending approvals and Plan mode questions in the same request block", () => {
    const parent = document.createElement("div");
    const approval = pendingApproval();
    const input = pendingUserInput();

    renderPendingRequestMessage(
      parent,
      [approval],
      [input],
      {
        values: new Map(),
        draftKey: (requestId, questionId) => `${String(requestId)}:${questionId}`,
        otherDraftKey: (requestId, questionId) => `${String(requestId)}:${questionId}:other`,
      },
      new Set(),
      { resolveApproval: vi.fn(), resolveUserInput: vi.fn(), cancelUserInput: vi.fn() },
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

  it("renders submitted user input separately from approvals", () => {
    const block = messageRenderBlocks({
      activeThreadId: "thread",
      activeTurnId: "turn",
      historyCursor: null,
      loadingHistory: false,
      busy: false,
      displayItems: [
        {
          id: "user-input-submitted-1",
          kind: "userInputResult",
          role: "tool",
          text: "Input submitted for 1 question.",
          turnId: "turn",
          markdown: false,
          state: "completed",
          details: [{ title: "Scope", rows: [{ key: "answer", value: "Narrow" }] }],
        },
      ],
      openDetails: new Set(),
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
      renderTextWithWikiLinks: (parent, text) => parent.createDiv({ text }),
    })[0];

    const element = block.render();

    expect(element.querySelector(".codex-panel__message-role")?.textContent).toBe("Input");
    expect(element.textContent).not.toContain("Approval");
    expect(element.querySelector("details summary")?.textContent).toBe("Scope");
    expect(element.querySelector(".codex-panel__meta-grid")?.textContent).toContain("answerNarrow");
  });

  it("renders manual approval results with completion state and details", () => {
    const block = messageRenderBlocks({
      activeThreadId: "thread",
      activeTurnId: "turn",
      historyCursor: null,
      loadingHistory: false,
      busy: false,
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

    const element = block.render();

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
    const block = messageRenderBlocks({
      activeThreadId: "thread",
      activeTurnId: null,
      historyCursor: null,
      loadingHistory: false,
      busy: false,
      displayItems: [
        {
          id: "assistant-1",
          kind: "message",
          role: "assistant",
          text: "Done",
          turnId: "turn",
          markdown: true,
          autoReviewSummaries: ["Auto-review approved: npm test"],
        },
      ],
      openDetails: new Set(),
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
      renderTextWithWikiLinks: (parent, text) => parent.createDiv({ text }),
    })[0];

    const element = block.render();

    expect(element.querySelector(".codex-panel__auto-reviews summary")?.textContent).toBe("Auto-reviewed 1 request");
    expect(element.querySelector(".codex-panel__auto-reviews")?.textContent).toContain("Auto-review approved: npm test");
  });

  it("adds pending requests to the bottom of message render blocks", () => {
    const pending = document.createElement("div");
    pending.className = "codex-panel__pending-request-message";
    pending.textContent = "Request";

    const blocks = messageRenderBlocks({
      activeThreadId: "thread",
      activeTurnId: null,
      historyCursor: null,
      loadingHistory: false,
      busy: false,
      displayItems: [{ id: "a1", kind: "message", role: "assistant", text: "Done", markdown: true }],
      openDetails: new Set(),
      loadOlderTurns: vi.fn(),
      renderMarkdown: (parent, text) => parent.createDiv({ text }),
      renderTextWithWikiLinks: (parent, text) => parent.createDiv({ text }),
      pendingRequestsSignature: "request:1",
      renderPendingRequests: () => pending,
    });

    expect(blocks.map((block) => block.key)).toEqual(["item:a1", "pending-requests"]);
    expect(blocks[1].render()).toBe(pending);
  });

  it("renders composer suggestions outside normal input flow callbacks", () => {
    const parent = document.createElement("div");
    const onSuggestionInsert = vi.fn();
    const { composer, suggestions } = renderComposerShell(parent, "view", "", false, {
      onInput: vi.fn(),
      onUpdateSuggestions: vi.fn(),
      onKeydown: vi.fn(),
      onNewThread: vi.fn(),
      onSendOrInterrupt: vi.fn(),
      onSuggestionHover: vi.fn(),
      onSuggestionInsert,
    });

    renderComposerSuggestions(
      suggestions,
      composer,
      "view",
      [{ display: "/help", detail: "Show help", replacement: "/help", start: 0 }],
      0,
      { onSuggestionHover: vi.fn(), onSuggestionInsert },
    );

    expect(suggestions.getAttribute("role")).toBe("listbox");
    expect(composer.getAttribute("aria-expanded")).toBe("true");
    suggestions
      .querySelector<HTMLElement>(".codex-panel__composer-suggestion")
      ?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onSuggestionInsert).toHaveBeenCalled();
  });

  it("scrolls the selected composer suggestion fully into view below the viewport", () => {
    const { container, option } = composerSuggestionScrollFixture({
      clientHeight: 100,
      optionHeight: 32,
      optionTop: 92,
      scrollTop: 0,
    });

    scrollComposerSuggestionIntoView(container, option);

    expect(container.scrollTop).toBe(24);
  });

  it("scrolls the selected composer suggestion fully into view above the viewport", () => {
    const { container, option } = composerSuggestionScrollFixture({
      clientHeight: 100,
      optionHeight: 32,
      optionTop: 48,
      scrollTop: 64,
    });

    scrollComposerSuggestionIntoView(container, option);

    expect(container.scrollTop).toBe(48);
  });

  it("keeps composer suggestion scroll position when the selected item is already visible", () => {
    const { container, option } = composerSuggestionScrollFixture({
      clientHeight: 100,
      optionHeight: 32,
      optionTop: 72,
      scrollTop: 48,
    });

    scrollComposerSuggestionIntoView(container, option);

    expect(container.scrollTop).toBe(48);
  });

  it("uses the composer action for interrupt only when a running turn has no steering text", () => {
    const parent = document.createElement("div");
    const { composer } = renderComposerShell(parent, "view", "", true, {
      onInput: vi.fn(),
      onUpdateSuggestions: vi.fn(),
      onKeydown: vi.fn(),
      onNewThread: vi.fn(),
      onSendOrInterrupt: vi.fn(),
      onSuggestionHover: vi.fn(),
      onSuggestionInsert: vi.fn(),
    });
    const sendButton = parent.querySelector<HTMLButtonElement>(".codex-panel__send");

    syncComposerControls(parent, composer, true, true);
    expect(sendButton?.getAttribute("aria-label")).toBe("Interrupt");
    expect(sendButton?.classList.contains("is-interrupt")).toBe(true);
    expect(sendButton?.classList.contains("is-steer")).toBe(false);
    expect(sendButton?.dataset.icon).toBe("square");

    composer.value = "adjust course";
    syncComposerControls(parent, composer, true, true);
    expect(sendButton?.getAttribute("aria-label")).toBe("Steer");
    expect(sendButton?.classList.contains("is-interrupt")).toBe(false);
    expect(sendButton?.classList.contains("is-steer")).toBe(true);
    expect(sendButton?.dataset.icon).toBe("corner-down-right");
  });

  it("honors the smaller viewport branch of the composer max-height CSS", () => {
    const composer = document.createElement("textarea");
    const getComputedStyleMock = vi.spyOn(window, "getComputedStyle").mockReturnValue({
      minHeight: "76px",
      maxHeight: "min(208px, 40vh)",
    } as CSSStyleDeclaration);
    Object.defineProperty(window, "innerHeight", { value: 400, configurable: true });
    Object.defineProperty(composer, "scrollHeight", { value: 280, configurable: true });

    try {
      syncComposerHeight(composer);
    } finally {
      getComputedStyleMock.mockRestore();
    }

    expect(composer.style.height).toBe("160px");
    expect(composer.style.overflowY).toBe("auto");
  });
});

function toolbarModel(overrides: Partial<ToolbarViewModel> = {}): ToolbarViewModel {
  return {
    connected: true,
    status: "Connected.",
    statusState: "connected",
    historyOpen: false,
    statusPanelOpen: false,
    runtimeOpen: true,
    planActive: false,
    fastActive: false,
    runtimeSummary: "5.5 high",
    runtimeTitle: "Model: gpt-5.5; Effort: high",
    runtimeAriaLabel: "Runtime: gpt-5.5 high",
    runtimeEmphasized: false,
    context: null,
    rateLimit: null,
    configSections: [],
    openPanel: "runtime",
    threads: [{ title: "Thread", threadId: "thread", selected: true, disabled: false, canArchive: true, rename: null }],
    modelChoices: [{ label: "Default", selected: true, onClick: vi.fn() }],
    effortChoices: [{ label: "Default", selected: true, onClick: vi.fn() }],
    connectLabel: "Reconnect",
    diagnostics: [{ label: "running app-server", value: "codex-cli/test" }],
    ...overrides,
  };
}

function toolbarActions(overrides: Partial<Parameters<typeof renderToolbar>[2]> = {}): Parameters<typeof renderToolbar>[2] {
  return {
    toggleHistory: vi.fn(),
    toggleStatusPanel: vi.fn(),
    togglePlan: vi.fn(),
    toggleFast: vi.fn(),
    toggleRuntime: vi.fn(),
    connect: vi.fn(),
    refreshThreads: vi.fn(),
    resumeThread: vi.fn(),
    archiveThread: vi.fn(),
    startRenameThread: vi.fn(),
    updateRenameDraft: vi.fn(),
    saveRenameThread: vi.fn(),
    cancelRenameThread: vi.fn(),
    autoNameThread: vi.fn(),
    ...overrides,
  };
}

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
