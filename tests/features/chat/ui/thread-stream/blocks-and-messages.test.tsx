// @vitest-environment jsdom

import { MarkdownRenderer } from "obsidian";
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";
import { implementPlanTargetFromState } from "../../../../../src/features/chat/application/turns/plan-implementation";
import { pendingWebSubmissionItem } from "../../../../../src/features/chat/application/turns/web-submission";
import { setCollaborationModeIntent } from "../../../../../src/features/chat/domain/runtime/intent";
import type { ThreadStreamItem } from "../../../../../src/features/chat/domain/thread-stream/items";
import { THREAD_STREAM_CONTENT_RENDERED_EVENT } from "../../../../../src/features/chat/ui/thread-stream/content-rendered-event.dom";
import { ThreadStreamMarkdownRenderer } from "../../../../../src/features/chat/ui/thread-stream/markdown-renderer.obsidian";
import { deferred } from "../../../../support/async";
import { attributeValues, textContents, topLevelDetailsSummaries } from "../../../../support/dom";
import "./setup";
import {
  expectPresent,
  idleTurnLifecycle,
  renderThreadStreamBlockElement,
  renderThreadStreamBlocksInAct,
  runningTurnLifecycle,
  testDisclosures,
  threadStreamBlocks,
  unmountUiRootInAct,
  withStreamItemContentScrollHeight,
} from "./test-helpers";

describe("thread stream rendering and action menu", () => {
  it("inserts completed-turn activity groups between conversation blocks", () => {
    const parent = document.createElement("div");

    renderThreadStreamBlocksInAct(
      parent,
      threadStreamBlocks({
        items: [
          { id: "u1", kind: "dialogue", dialogueKind: "user", role: "user", text: "do it", turnId: "t1" },
          {
            id: "a1",
            kind: "dialogue",
            role: "assistant",
            text: "done",
            turnId: "t1",
            dialogueKind: "assistantResponse",
            dialogueState: "completed",
          },
        ],
      }),
    );
    renderThreadStreamBlocksInAct(
      parent,
      threadStreamBlocks({
        items: [
          { id: "u1", kind: "dialogue", dialogueKind: "user", role: "user", text: "do it", turnId: "t1" },
          {
            id: "hook-1",
            kind: "hook",
            role: "tool",
            text: "userPromptSubmit: Saving jj baseline",
            toolName: "hook",
            turnId: "t1",
            status: "completed",
          },
          {
            id: "a1",
            kind: "dialogue",
            role: "assistant",
            text: "done",
            turnId: "t1",
            dialogueKind: "assistantResponse",
            dialogueState: "completed",
          },
        ],
      }),
    );

    expect(attributeValues(parent, "[data-codex-panel-block-key]", "data-codex-panel-block-key")).toEqual([
      "item:u1",
      "activity:turn-t1-activity",
      "item:a1",
    ]);
    const activitySummary = parent.querySelector<HTMLElement>('[data-codex-panel-block-key="activity:turn-t1-activity"] summary');
    expect(activitySummary?.textContent).toBe("Work details");
    expect(activitySummary?.tabIndex).toBe(-1);
    unmountUiRootInAct(parent);
  });

  it("keeps Work details in the flow when the activity group is collapsed", async () => {
    const parent = document.createElement("div");
    const blocks = threadStreamBlocks({
      items: [
        { id: "u1", kind: "dialogue", dialogueKind: "user", role: "user", text: "do it", turnId: "t1" },
        {
          id: "hook-1",
          kind: "hook",
          role: "tool",
          text: "userPromptSubmit: Saving jj baseline",
          toolName: "hook",
          turnId: "t1",
          status: "completed",
        },
        {
          id: "a1",
          kind: "dialogue",
          role: "assistant",
          text: "done",
          turnId: "t1",
          dialogueKind: "assistantResponse",
          dialogueState: "completed",
        },
      ],
      disclosures: testDisclosures({ activityGroups: ["t1"] }),
    });
    const activityBlock = expectPresent(blocks.find((block) => block.key === "activity:turn-t1-activity"));

    renderThreadStreamBlocksInAct(parent, [activityBlock]);

    const host = expectPresent(parent.querySelector<HTMLElement>(".codex-panel__thread-stream-block"));
    const threadStreamFlow = expectPresent(parent.querySelector<HTMLElement>(".codex-panel__thread-stream-flow"));
    const activityGroup = expectPresent(parent.querySelector<HTMLDetailsElement>(".codex-panel__activity-group"));

    Object.defineProperty(host, "offsetHeight", { value: 520, configurable: true });
    await act(async () => {
      activityGroup.dispatchEvent(new Event(THREAD_STREAM_CONTENT_RENDERED_EVENT, { bubbles: true }));
      await Promise.resolve();
    });
    expect(threadStreamFlow.style.height).toBe("");
    expect(host.style.transform).toBe("");

    Object.defineProperty(host, "offsetHeight", { value: 120, configurable: true });
    await act(async () => {
      activityGroup.open = false;
      activityGroup.dispatchEvent(new Event("toggle"));
      await Promise.resolve();
    });

    expect(threadStreamFlow.style.height).toBe("");
    expect(host.style.transform).toBe("");
    unmountUiRootInAct(parent);
  });

  it("keeps blocks in the flow after their rendered content shrinks on rerender", () => {
    const parent = document.createElement("div");
    const block = threadStreamBlocks({
      items: [{ id: "u1", kind: "dialogue", dialogueKind: "user", role: "user", text: "expanded", turnId: "t1" }],
    })[0];

    renderThreadStreamBlocksInAct(parent, [block]);

    const host = expectPresent(parent.querySelector<HTMLElement>(".codex-panel__thread-stream-block"));
    const threadStreamFlow = expectPresent(parent.querySelector<HTMLElement>(".codex-panel__thread-stream-flow"));

    Object.defineProperty(host, "offsetHeight", { value: 520, configurable: true });
    void act(() => {
      host.dispatchEvent(new Event(THREAD_STREAM_CONTENT_RENDERED_EVENT, { bubbles: true }));
    });
    expect(threadStreamFlow.style.height).toBe("");
    expect(host.style.transform).toBe("");

    Object.defineProperty(host, "offsetHeight", { value: 120, configurable: true });
    renderThreadStreamBlocksInAct(parent, [
      threadStreamBlocks({
        items: [{ id: "u1", kind: "dialogue", dialogueKind: "user", role: "user", text: "collapsed", turnId: "t1" }],
      })[0],
    ]);

    expect(threadStreamFlow.style.height).toBe("");
    expect(host.style.transform).toBe("");
    unmountUiRootInAct(parent);
  });

  it("renders review result items as compact auto-review tool rows", () => {
    const block = threadStreamBlocks({
      items: [{ id: "review-1", kind: "reviewResult", role: "tool", text: "Auto-review denied this command." }],
    })[0];

    const element = renderThreadStreamBlockElement(block);

    expect(element.classList.contains("codex-panel__stream-item--review-result")).toBe(true);
    expect(element.classList.contains("codex-panel__detail--plain")).toBe(true);
    expect(element.querySelector(".codex-panel__stream-item-role")?.textContent).toBe("auto-review");
    expect(element.textContent).toContain("Auto-review denied this command.");
    expect(element.querySelector("details")).toBeNull();
  });

  it("renders review result details inside one auto-review details block", () => {
    const block = threadStreamBlocks({
      items: [
        {
          id: "review-1",
          kind: "reviewResult",
          role: "tool",
          text: "Auto-review approved: npm test",
          turnId: "turn",
          executionState: "completed",
          review: {
            auditFacts: [
              { key: "status", value: "approved" },
              { key: "action", value: "apply patch" },
              { key: "files", value: "src/shared/ui/detail-view.ts\nsrc/shared/ui/thread-stream.ts" },
            ],
          },
        },
      ],
    })[0];

    const element = renderThreadStreamBlockElement(block);

    expect(element.classList.contains("codex-panel__execution--completed")).toBe(true);
    expect(topLevelDetailsSummaries(element)).toEqual(["auto-review"]);
    expect(textContents(element, "details summary")).toEqual(["auto-review"]);
    expect(element.textContent).not.toContain("Details");
    expect(element.textContent).not.toContain("▶Review");
    expect(element.querySelector(".codex-panel__meta-grid")?.textContent).toContain("statusapproved");
    expect(element.querySelector(".codex-panel__meta-grid")?.textContent).toContain("actionapply patch");
    expect(element.querySelector(".codex-panel__meta-grid")?.textContent).toContain(
      "filessrc/shared/ui/detail-view.ts\nsrc/shared/ui/thread-stream.ts",
    );
    expect(textContents(element, ".codex-panel__output-title")).toEqual([]);
  });

  it("renders structured system result details as visible selectable meta rows", () => {
    const renderMarkdown = vi.fn((parent: HTMLElement, text: string) => parent.createDiv({ text: `markdown:${text}` }));
    const block = threadStreamBlocks({
      items: [
        {
          id: "system-help",
          kind: "system",
          role: "system",
          text: "Available slash commands",
          noticeSections: [
            {
              title: "Thread",
              auditFacts: [
                { key: "/help", value: "Show available Codex slash commands." },
                { key: "/resume [thread]", value: "Resume a recent Codex thread." },
              ],
            },
            {
              title: "Runtime",
              auditFacts: [{ key: "/doctor", value: "Show Codex CLI and Codex App Server diagnostics." }],
            },
          ],
        },
      ],
      renderMarkdown,
    })[0];

    const element = renderThreadStreamBlockElement(block);

    expect(element.classList.contains("codex-panel__stream-item--system")).toBe(true);
    expect(element.querySelector(".codex-panel__stream-item-content")?.textContent).toBe("Available slash commands");
    expect(element.querySelector(".codex-panel__stream-item-content")?.classList.contains("markdown-rendered")).toBe(false);
    expect(renderMarkdown).not.toHaveBeenCalled();
    expect(element.querySelector("details")).toBeNull();
    expect(element.querySelector(".codex-panel__output-title")).toBeNull();
    expect(element.querySelector(".codex-panel__meta-grid")).toBeNull();
    expect(element.querySelectorAll(".codex-panel__system-result-grid")).toHaveLength(1);
    expect(textContents(element, ".codex-panel__system-result-heading")).toEqual(["Thread", "Runtime"]);
    expect(element.querySelector(".codex-panel__system-result-grid")?.textContent).toContain("/helpShow available Codex slash commands.");
    expect(element.querySelector(".codex-panel__system-result-grid")?.textContent).toContain(
      "/resume [thread]Resume a recent Codex thread.",
    );
    expect(element.querySelector(".codex-panel__system-result-grid")?.textContent).toContain(
      "/doctorShow Codex CLI and Codex App Server diagnostics.",
    );
  });

  it("renders goal events as collapsed tool-like thread stream items", () => {
    const block = threadStreamBlocks({
      items: [
        {
          id: "goal-1",
          kind: "goal",
          role: "tool",
          text: "set: Ship the feature",
          action: "set",
          objective: "Ship the feature",
        },
      ],
      renderMarkdown: (element, text) => element.createDiv({ text }),
    })[0];

    const element = renderThreadStreamBlockElement(block);

    expect(element.classList.contains("codex-panel__stream-item--tool")).toBe(true);
    expect(element.querySelector(".codex-panel__detail-label")?.textContent).toBe("goal");
    expect(element.querySelector(".codex-panel__stream-summary")?.textContent).toBe("set: Ship the feature");
    expect(element.querySelector("details")?.open).toBe(false);
    expect(element.querySelector(".codex-panel__meta-grid")?.textContent).toContain("actionset");
    expect(element.querySelector(".codex-panel__output-title")?.textContent).toBe("Objective");
    expect(element.querySelector("pre")?.textContent).toBe("Ship the feature");
  });

  it("renders rollback action only for the eligible user dialogue", () => {
    const onRollback = vi.fn();
    const items = [
      { id: "u1", kind: "dialogue", dialogueKind: "user", role: "user", text: "older", turnId: "turn-1" },
      {
        id: "a1",
        kind: "dialogue",
        role: "assistant",
        text: "older answer",
        turnId: "turn-1",
        dialogueKind: "assistantResponse",
        dialogueState: "completed",
      },
      { id: "u2", kind: "dialogue", dialogueKind: "user", role: "user", text: "latest", turnId: "turn-2" },
    ] as const;
    const blocks = threadStreamBlocks({
      items: [...items],
      textActionTargetsByItemId: new Map([["u2", { rollback: true }]]),
      onRollback,
    });

    const rendered = blocks.map((block) => renderThreadStreamBlockElement(block));

    expect(expectPresent(rendered[0]).querySelector(".codex-panel__rollback-turn")).toBeNull();
    expect(expectPresent(rendered[1]).querySelector(".codex-panel__rollback-turn")).toBeNull();
    const button = expectPresent(rendered[2]).querySelector<HTMLButtonElement>(".codex-panel__rollback-turn");
    expect(button?.getAttribute("aria-label")).toBe("Roll back latest turn");
    button?.click();
    expect(onRollback).toHaveBeenCalledWith();
  });

  it("renders copy actions for copyable messages", () => {
    const copyText = vi.fn();
    const blocks = threadStreamBlocks({
      items: [
        { id: "u1", kind: "dialogue", dialogueKind: "user", role: "user", text: "rendered user", copyText: "**user**", turnId: "turn-1" },
        {
          id: "a1",
          kind: "dialogue",
          role: "assistant",
          text: "rendered answer",
          copyText: "# Answer",
          turnId: "turn-1",
          dialogueKind: "assistantResponse",
          dialogueState: "completed",
        },
      ],
      copyText,
    });

    const rendered = blocks.map((block) => renderThreadStreamBlockElement(block));
    const userButton = expectPresent(rendered[0]).querySelector<HTMLButtonElement>(".codex-panel__copy-dialogue");
    const assistantButton = expectPresent(rendered[1]).querySelector<HTMLButtonElement>(".codex-panel__copy-dialogue");

    expect(userButton?.getAttribute("aria-label")).toBe("Copy message");
    expect(assistantButton?.getAttribute("aria-label")).toBe("Copy message");
    userButton?.click();
    assistantButton?.click();
    expect(copyText).toHaveBeenNthCalledWith(1, "**user**");
    expect(copyText).toHaveBeenNthCalledWith(2, "# Answer");
  });

  it("expands assistant fork actions in the copy action region and defaults repeat clicks to plain fork", () => {
    const onForkMenuToggle = vi.fn();
    const onFork = vi.fn();
    const item: ThreadStreamItem = {
      id: "a1",
      kind: "dialogue",
      role: "assistant",
      dialogueKind: "assistantResponse",
      dialogueState: "completed",
      text: "answer",
      copyText: "answer",
      turnId: "turn-1",
    };

    const closedBlock = threadStreamBlocks({
      items: [item],
      onForkMenuToggle,
      copyText: vi.fn(),
      textActionTargetsByItemId: new Map([["a1", { fork: { itemId: "a1", turnId: "turn-1" } }]]),
      onFork,
    })[0];

    const closedElement = renderThreadStreamBlockElement(closedBlock);
    expect(closedElement.querySelector(".codex-panel__copy-dialogue")).not.toBeNull();
    const initialFork = expectPresent(closedElement.querySelector<HTMLButtonElement>(".codex-panel__fork-dialogue"));
    expect(initialFork.getAttribute("aria-label")).toBe("Fork from here");
    expect(initialFork.getAttribute("data-icon")).toBe("lucide-split");
    initialFork.click();
    expect(onForkMenuToggle).toHaveBeenCalledWith("a1");

    const openBlock = threadStreamBlocks({
      items: [item],
      forkMenuItemId: "a1",
      onForkMenuToggle,
      copyText: vi.fn(),
      textActionTargetsByItemId: new Map([["a1", { fork: { itemId: "a1", turnId: "turn-1" } }]]),
      onFork,
    })[0];

    const openElement = renderThreadStreamBlockElement(openBlock);
    expect(openElement.querySelector(".codex-panel__copy-dialogue")).toBeNull();
    expect(openElement.querySelector<HTMLButtonElement>(".codex-panel__fork-and-archive-dialogue")?.getAttribute("aria-label")).toBe(
      "Fork and archive",
    );
    const openFork = expectPresent(openElement.querySelector<HTMLButtonElement>(".codex-panel__fork-dialogue"));
    expect(openFork.getAttribute("aria-label")).toBe("Fork");
    expect(openFork.getAttribute("data-icon")).toBe("file-plus-corner");
    openFork.click();
    expect(onFork).toHaveBeenCalledWith({ itemId: "a1", turnId: "turn-1" }, false);
  });

  it("runs fork and archive from the expanded assistant fork actions", () => {
    const onFork = vi.fn();
    const item: ThreadStreamItem = {
      id: "a1",
      kind: "dialogue",
      role: "assistant",
      dialogueKind: "assistantResponse",
      dialogueState: "completed",
      text: "answer",
      copyText: "answer",
      turnId: "turn-1",
    };
    const block = threadStreamBlocks({
      items: [item],
      forkMenuItemId: "a1",
      onForkMenuToggle: vi.fn(),
      copyText: vi.fn(),
      textActionTargetsByItemId: new Map([["a1", { fork: { itemId: "a1", turnId: "turn-1" } }]]),
      onFork,
    })[0];

    const element = renderThreadStreamBlockElement(block);
    expectPresent(element.querySelector<HTMLButtonElement>(".codex-panel__fork-and-archive-dialogue")).click();

    expect(onFork).toHaveBeenCalledWith({ itemId: "a1", turnId: "turn-1" }, true);
  });

  it("updates text item content when a streaming plan delta completes", () => {
    const parent = document.createElement("div");
    const baseContext = {
      renderMarkdown: (element: HTMLElement, text: string) => element.createDiv({ text: `markdown:${text}` }),
    };

    renderThreadStreamBlocksInAct(
      parent,
      threadStreamBlocks({
        ...baseContext,
        items: [
          {
            id: "a1",
            kind: "dialogue",
            role: "assistant",
            text: "**answer** [[Note]]",
            turnId: "turn-1",
            dialogueKind: "proposedPlan",
            dialogueState: "streaming",
          },
        ],
      }),
    );
    expect(parent.querySelector(".codex-panel__stream-item-content")?.textContent).toBe("**answer** [[Note]]");
    expect(parent.querySelector(".codex-panel__stream-item-content a")).toBeNull();

    renderThreadStreamBlocksInAct(
      parent,
      threadStreamBlocks({
        ...baseContext,
        items: [
          {
            id: "a1",
            kind: "dialogue",
            role: "assistant",
            text: "**answer**",
            turnId: "turn-1",
            dialogueKind: "assistantResponse",
            dialogueState: "completed",
          },
        ],
      }),
    );
    expect(parent.querySelector(".codex-panel__stream-item-content")?.textContent).toBe("markdown:**answer**");
    unmountUiRootInAct(parent);
  });

  it("updates keyed text item content", () => {
    const parent = document.createElement("div");
    const renderMarkdown = (element: HTMLElement, text: string) => {
      const rendered = element.createDiv({ text: `markdown:${text}` });
      element.replaceChildren(rendered);
    };
    const baseContext = {
      renderMarkdown,
    };

    renderThreadStreamBlocksInAct(
      parent,
      threadStreamBlocks({
        ...baseContext,
        items: [
          {
            id: "a1",
            kind: "dialogue",
            role: "assistant",
            text: "first",
            turnId: "turn-1",
            dialogueKind: "assistantResponse",
            dialogueState: "completed",
          },
        ],
      }),
    );
    expect(parent.querySelector('[data-codex-panel-block-key="item:a1"] .codex-panel__stream-item-content')?.textContent).toBe(
      "markdown:first",
    );

    renderThreadStreamBlocksInAct(
      parent,
      threadStreamBlocks({
        ...baseContext,
        items: [
          {
            id: "a1",
            kind: "dialogue",
            role: "assistant",
            text: "second",
            turnId: "turn-1",
            dialogueKind: "assistantResponse",
            dialogueState: "completed",
          },
        ],
      }),
    );

    expect(parent.querySelector('[data-codex-panel-block-key="item:a1"] .codex-panel__stream-item-content')?.textContent).toBe(
      "markdown:second",
    );
    unmountUiRootInAct(parent);
  });

  it("keeps rendered markdown content while replacement rendering is pending", async () => {
    const parent = document.createElement("div");
    const secondRender = deferred<undefined>();
    const renderMarkdown = vi.spyOn(MarkdownRenderer, "render");
    renderMarkdown
      .mockImplementationOnce((_app, text: string, element: HTMLElement) => {
        element.textContent = `rendered:${text}`;
        return Promise.resolve();
      })
      .mockImplementationOnce((_app, text: string, element: HTMLElement) =>
        secondRender.promise.then(() => {
          element.textContent = `rendered:${text}`;
        }),
      );
    const markdownRenderer = new ThreadStreamMarkdownRenderer({
      app: { workspace: { getActiveFile: vi.fn(() => null) } } as never,
      owner: {} as never,
      vaultPath: "/vault",
    });
    const baseContext = {
      renderMarkdown: (element: HTMLElement, text: string) => {
        markdownRenderer.renderObsidianMarkdown(element, text);
      },
    };

    renderThreadStreamBlocksInAct(
      parent,
      threadStreamBlocks({
        ...baseContext,
        items: [
          {
            id: "a1",
            kind: "dialogue",
            role: "assistant",
            text: "old",
            turnId: "turn-1",
            dialogueKind: "assistantResponse",
            dialogueState: "completed",
          },
        ],
      }),
    );
    await Promise.resolve();
    const content = expectPresent(parent.querySelector<HTMLElement>(".codex-panel__stream-item-content"));
    expect(content.textContent).toBe("rendered:old");

    renderThreadStreamBlocksInAct(
      parent,
      threadStreamBlocks({
        ...baseContext,
        items: [
          {
            id: "a1",
            kind: "dialogue",
            role: "assistant",
            text: "new",
            turnId: "turn-1",
            dialogueKind: "assistantResponse",
            dialogueState: "completed",
          },
        ],
      }),
    );
    const contentAfterUpdate = expectPresent(parent.querySelector<HTMLElement>(".codex-panel__stream-item-content"));
    expect(contentAfterUpdate).toBe(content);
    expect(contentAfterUpdate.textContent).toBe("rendered:old");

    secondRender.resolve(undefined);
    await Promise.resolve();
    await Promise.resolve();

    expect(contentAfterUpdate.textContent).toBe("rendered:new");
    renderMarkdown.mockRestore();
    unmountUiRootInAct(parent);
  });

  it("uses stream markdown for streaming assistant responses without calling the Obsidian renderer", async () => {
    const parent = document.createElement("div");
    const renderMarkdown = vi.spyOn(MarkdownRenderer, "render");
    renderMarkdown.mockImplementation((_app, text: string, element: HTMLElement) => {
      element.textContent = `obsidian:${text}`;
      return Promise.resolve();
    });
    const renderStreamMarkdown = vi.fn((element: HTMLElement, text: string) => {
      element.replaceChildren(element.createEl("strong", { text: `stream:${text.replace(/\*/g, "")}` }));
    });
    const baseContext = {
      renderObsidianMarkdown: vi.fn(),
      renderStreamMarkdown,
    };

    renderThreadStreamBlocksInAct(
      parent,
      threadStreamBlocks({
        ...baseContext,
        items: [
          {
            id: "a1",
            kind: "dialogue",
            role: "assistant",
            text: "old",
            turnId: "turn-1",
            dialogueKind: "assistantResponse",
            dialogueState: "streaming",
          },
        ],
      }),
    );

    expect(parent.querySelector(".codex-panel__stream-item-content")?.innerHTML).toBe("<strong>stream:old</strong>");
    expect(renderStreamMarkdown).toHaveBeenCalledWith(expect.any(HTMLElement), "old");
    expect(baseContext.renderObsidianMarkdown).not.toHaveBeenCalled();
    expect(renderMarkdown).not.toHaveBeenCalled();
    renderMarkdown.mockRestore();
    unmountUiRootInAct(parent);
  });

  it("uses Obsidian markdown for completed assistant responses", async () => {
    const parent = document.createElement("div");
    const renderMarkdown = vi.spyOn(MarkdownRenderer, "render");
    renderMarkdown.mockImplementationOnce((_app, text: string, element: HTMLElement) => {
      element.textContent = `obsidian:${text}`;
      return Promise.resolve();
    });
    const markdownRenderer = new ThreadStreamMarkdownRenderer({
      app: { workspace: { getActiveFile: vi.fn(() => null) } } as never,
      owner: {} as never,
      vaultPath: "/vault",
    });

    renderThreadStreamBlocksInAct(
      parent,
      threadStreamBlocks({
        renderObsidianMarkdown: (element: HTMLElement, text: string) => {
          markdownRenderer.renderObsidianMarkdown(element, text);
        },
        renderStreamMarkdown: vi.fn(),
        items: [
          {
            id: "a1",
            kind: "dialogue",
            role: "assistant",
            text: "**done**",
            turnId: "turn-1",
            dialogueKind: "assistantResponse",
            dialogueState: "completed",
          },
        ],
      }),
    );
    await Promise.resolve();

    expect(parent.querySelector(".codex-panel__stream-item-content")?.textContent).toBe("obsidian:**done**");
    expect(renderMarkdown).toHaveBeenCalledOnce();
    renderMarkdown.mockRestore();
    unmountUiRootInAct(parent);
  });

  it("ignores stale async markdown renders targeting the same connected content element", async () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const firstRender = deferred<undefined>();
    const renderMarkdown = vi.spyOn(MarkdownRenderer, "render");
    renderMarkdown
      .mockImplementationOnce((_app, text: string, element: HTMLElement) =>
        firstRender.promise.then(() => {
          element.textContent = `stale:${text}`;
        }),
      )
      .mockImplementation((_app, text: string, element: HTMLElement) => {
        element.textContent = `fresh:${text}`;
        return Promise.resolve();
      });
    const markdownRenderer = new ThreadStreamMarkdownRenderer({
      app: { workspace: { getActiveFile: vi.fn(() => null) } } as never,
      owner: {} as never,
      vaultPath: "/vault",
    });

    markdownRenderer.renderObsidianMarkdown(parent, "old");
    markdownRenderer.renderObsidianMarkdown(parent, "new");
    await Promise.resolve();
    expect(parent.textContent).toBe("fresh:new");

    firstRender.resolve(undefined);
    await Promise.resolve();
    await Promise.resolve();

    expect(parent.textContent).toBe("fresh:new");
    renderMarkdown.mockRestore();
    parent.remove();
  });

  it("hides copy action for the active assistant dialogue while a turn is running", () => {
    const item = {
      id: "a-running",
      sourceItemId: "a-running",
      kind: "dialogue",
      role: "assistant",
      dialogueKind: "assistantResponse",
      dialogueState: "completed",
      text: "partial",
      copyText: "partial",
      turnId: "turn-1",
    } as const;
    const context = {
      turnLifecycle: runningTurnLifecycle("turn-1"),
      items: [item],
      renderMarkdown: (parent: HTMLElement, text: string) => parent.createDiv({ text }),
      copyText: vi.fn(),
    };

    const runningBlock = threadStreamBlocks(context)[0];
    const completedBlock = threadStreamBlocks({ ...context, turnLifecycle: idleTurnLifecycle() })[0];

    expect(renderThreadStreamBlockElement(runningBlock).querySelector(".codex-panel__copy-dialogue")).toBeNull();
    expect(renderThreadStreamBlockElement(completedBlock).querySelector(".codex-panel__copy-dialogue")).not.toBeNull();
  });

  it("renders implement plan action for eligible proposed plans", () => {
    const onImplementPlan = vi.fn();
    const block = threadStreamBlocks({
      items: [
        {
          id: "p1",
          kind: "dialogue",
          role: "assistant",
          text: "# Plan",
          copyText: "# Plan",
          turnId: "turn-1",
          dialogueKind: "proposedPlan",
          dialogueState: "completed",
        },
      ],
      copyText: vi.fn(),
      textActionTargetsByItemId: new Map([["p1", { implementPlan: { itemId: "p1" } }]]),
      onImplementPlan,
    })[0];

    const element = renderThreadStreamBlockElement(block);
    const button = element.querySelector<HTMLButtonElement>(".codex-panel__implement-plan");

    expect(button?.getAttribute("aria-label")).toBe("Implement plan");
    button?.click();
    expect(onImplementPlan).toHaveBeenCalledWith({ itemId: "p1" });
  });

  it("selects only the latest proposed plan as an implement candidate", () => {
    const firstPlan = {
      id: "p1",
      kind: "dialogue",
      role: "assistant",
      text: "# First plan",
      turnId: "turn-1",
      dialogueKind: "proposedPlan",
      dialogueState: "completed",
    } as const;
    const secondPlan = {
      id: "p2",
      kind: "dialogue",
      role: "assistant",
      text: "# Second plan",
      turnId: "turn-2",
      dialogueKind: "proposedPlan",
      dialogueState: "completed",
    } as const;
    const baseState = {
      activeThread: { id: "thread" },
      turn: { lifecycle: { kind: "idle" as const } },
      runtime: { pending: { collaborationMode: setCollaborationModeIntent("plan") } },
      threadStream: {
        stableItems: [
          firstPlan,
          {
            id: "a1",
            kind: "dialogue",
            role: "assistant",
            text: "answer",
            dialogueKind: "assistantResponse",
            dialogueState: "completed",
          } as const,
          secondPlan,
        ],
        activeSegment: null,
      },
    };

    expect(implementPlanTargetFromState(baseState)).toEqual({ itemId: secondPlan.id });
    expect(
      implementPlanTargetFromState({ ...baseState, runtime: { pending: { collaborationMode: setCollaborationModeIntent("default") } } }),
    ).toBeNull();
    expect(implementPlanTargetFromState({ ...baseState, turn: { lifecycle: { kind: "running", turnId: "turn-2" } } })).toBeNull();
  });

  it("does not render copy actions for tool items", () => {
    const block = threadStreamBlocks({
      items: [
        {
          id: "tool-1",
          kind: "tool",
          role: "tool",
          text: "tool summary",
          turnId: "turn",
          toolName: "web search",
        },
      ],
      copyText: vi.fn(),
    })[0];

    expect(renderThreadStreamBlockElement(block).querySelector(".codex-panel__copy-dialogue")).toBeNull();
  });

  it("renders copy and rollback actions together when both apply", () => {
    const copyText = vi.fn();
    const onRollback = vi.fn();
    const block = threadStreamBlocks({
      items: [{ id: "u1", kind: "dialogue", dialogueKind: "user", role: "user", text: "latest", copyText: "latest", turnId: "turn-1" }],
      copyText,
      textActionTargetsByItemId: new Map([["u1", { rollback: true }]]),
      onRollback,
    })[0];

    const element = renderThreadStreamBlockElement(block);
    element.querySelector<HTMLButtonElement>(".codex-panel__copy-dialogue")?.click();
    element.querySelector<HTMLButtonElement>(".codex-panel__rollback-turn")?.click();

    expect(copyText).toHaveBeenCalledWith("latest");
    expect(onRollback).toHaveBeenCalledWith();
  });

  it("collapses tall user dialogues without changing the copy payload", () => {
    withStreamItemContentScrollHeight(500, () => {
      const parent = document.createElement("div");
      const copyText = vi.fn();
      const expandedMessages = new Set<string>();
      const onDisclosureToggle = vi.fn((bucket: string, id: string, open: boolean) => {
        if (bucket !== "userDialogueExpanded") return;
        if (open) {
          expandedMessages.add(id);
        } else {
          expandedMessages.delete(id);
        }
      });
      const render = () => {
        const blocks = threadStreamBlocks({
          items: [
            {
              id: "u1",
              kind: "dialogue",
              dialogueKind: "user",
              role: "user",
              text: "visible text",
              copyText: "full copied text",
              turnId: "turn-1",
            },
          ],
          disclosures: testDisclosures({ userDialogueExpanded: [...expandedMessages] }),
          onDisclosureToggle,
          copyText,
        });
        renderThreadStreamBlocksInAct(parent, blocks);
      };
      render();

      const content = () => parent.querySelector<HTMLElement>(".codex-panel__stream-item-content");
      const details = () => parent.querySelector<HTMLDetailsElement>(".codex-panel__stream-item-collapse-details");

      expect(content()?.classList.contains("codex-panel__stream-item-content--collapsed")).toBe(true);
      expect(details()?.hidden).toBe(false);
      expect(details()?.querySelector("summary")?.textContent).toBe("Show more");

      const showMore = details();
      if (showMore) {
        void act(() => {
          showMore.open = true;
          showMore.dispatchEvent(new Event("toggle"));
        });
      }
      render();
      expect(expandedMessages.has("u1")).toBe(true);
      expect(content()?.classList.contains("codex-panel__stream-item-content--collapsed")).toBe(false);
      expect(details()?.hidden).toBe(true);
      expect(onDisclosureToggle).toHaveBeenCalledWith("userDialogueExpanded", "u1", true);

      void act(() => {
        document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      });
      render();
      expect(expandedMessages.has("u1")).toBe(false);
      expect(content()?.classList.contains("codex-panel__stream-item-content--collapsed")).toBe(true);
      expect(details()?.hidden).toBe(false);
      expect(onDisclosureToggle).toHaveBeenCalledWith("userDialogueExpanded", "u1", false);

      parent.querySelector<HTMLButtonElement>(".codex-panel__copy-dialogue")?.click();
      expect(copyText).toHaveBeenCalledWith("full copied text");
      unmountUiRootInAct(parent);
      parent.remove();
    });
  });

  it("does not show the collapse control for short user dialogues or assistant dialogues", () => {
    withStreamItemContentScrollHeight(120, () => {
      const shortUserBlock = threadStreamBlocks({
        items: [{ id: "u1", kind: "dialogue", dialogueKind: "user", role: "user", text: "short", turnId: "turn-1" }],
      })[0];
      const shortUser = renderThreadStreamBlockElement(shortUserBlock);

      expect(shortUser.querySelector<HTMLDetailsElement>(".codex-panel__stream-item-collapse-details")?.hidden).toBe(true);
    });

    withStreamItemContentScrollHeight(500, () => {
      const assistantBlock = threadStreamBlocks({
        items: [
          {
            id: "a1",
            kind: "dialogue",
            role: "assistant",
            text: "long",
            turnId: "turn-1",
            dialogueKind: "assistantResponse",
            dialogueState: "completed",
          },
        ],
      })[0];
      const assistant = renderThreadStreamBlockElement(assistantBlock);

      expect(assistant.querySelector(".codex-panel__stream-item-collapse-details")).toBeNull();
    });
  });

  it("renders command items as a compact summary with output behind details", () => {
    const block = threadStreamBlocks({
      turnLifecycle: runningTurnLifecycle("turn"),
      items: [
        {
          id: "cmd-1",
          kind: "command",
          role: "tool",
          commandAction: "command",
          commandTarget: { kind: "command", commandLine: "npm run check" },
          turnId: "turn",
          command: "npm run check",
          cwd: "/vault",
          status: "failed",
          exitCode: 1,
          output: "stderr details",
        },
      ],
    })[0];

    const element = renderThreadStreamBlockElement(block);

    expect(element.querySelector(".codex-panel__stream-summary")?.textContent).toBe("npm run check (exit 1)");
    expect(element.querySelector(".codex-panel__stream-summary")?.getAttribute("title")).toBeNull();
    expect(topLevelDetailsSummaries(element)).toEqual(["command"]);
    expect(textContents(element, "details summary")).toEqual(["command"]);
    expect(element.textContent).not.toContain("Details");
    expect(textContents(element, ".codex-panel__output-title")).toEqual(["Output"]);
    expect(element.querySelector(".codex-panel__output pre")?.textContent).toBe("stderr details");
    expect(element.querySelector("details")?.hasAttribute("open")).toBe(false);
  });

  it("omits command exit and duration rows while they are unavailable", () => {
    const block = threadStreamBlocks({
      turnLifecycle: runningTurnLifecycle("turn"),
      items: [
        {
          id: "cmd-1",
          kind: "command",
          role: "tool",
          commandAction: "command",
          commandTarget: { kind: "command", commandLine: "npm run check" },
          turnId: "turn",
          command: "npm run check",
          cwd: "/vault",
          status: "inProgress",
          output: "",
        },
      ],
    })[0];

    const element = renderThreadStreamBlockElement(block);
    const metaText = element.querySelector(".codex-panel__meta-grid")?.textContent ?? "";

    expect(metaText).toContain("commandnpm run check");
    expect(metaText).toContain("statusinProgress");
    expect(metaText).not.toContain("exit");
    expect(metaText).not.toContain("duration");
    expect(metaText).not.toContain("undefined");
  });

  it("uses read as the command header for parsed file reads", () => {
    const block = threadStreamBlocks({
      turnLifecycle: runningTurnLifecycle("turn"),
      items: [
        {
          id: "cmd-1",
          kind: "command",
          role: "tool",
          commandAction: "read",
          commandTarget: { kind: "read", path: "/vault/src/main.ts", name: "main.ts" },
          turnId: "turn",
          command: "sed -n '1,20p' src/main.ts",
          cwd: "/vault",
          status: "completed",
          exitCode: 0,
          output: "contents",
        },
      ],
    })[0];

    const element = renderThreadStreamBlockElement(block);

    expect(textContents(element, "details summary")).toEqual(["read"]);
  });

  it("derives command summaries from semantic command targets instead of item text", () => {
    const block = threadStreamBlocks({
      turnLifecycle: runningTurnLifecycle("turn"),
      items: [
        {
          id: "cmd-1",
          kind: "command",
          role: "tool",
          commandAction: "search",
          commandTarget: { kind: "search", query: "semantic target", path: "/vault/src" },
          turnId: "turn",
          command: "rg 'semantic target' /vault/src",
          cwd: "/vault",
          status: "completed",
          output: "results",
        },
      ],
    })[0];

    const element = renderThreadStreamBlockElement(block);

    expect(element.querySelector(".codex-panel__stream-summary")?.textContent).toBe('"semantic target" in src');
  });

  it("renders file diffs inside a single file change details block", () => {
    const block = threadStreamBlocks({
      turnLifecycle: runningTurnLifecycle("turn"),
      workspaceRoot: "/vault/project",
      items: [
        {
          id: "patch-1",
          kind: "fileChange",
          role: "tool",
          turnId: "turn",
          status: "completed",
          changes: [{ kind: "update", path: "/vault/project/src/main.ts", diff: "@@\n-old\n+new" }],
          output: "patch applied",
        },
      ],
    })[0];

    const element = renderThreadStreamBlockElement(block);

    expect(element.querySelector(".codex-panel__stream-summary")?.textContent).toBe("src/main.ts");
    expect(topLevelDetailsSummaries(element)).toEqual(["file change"]);
    expect(textContents(element, "details summary")).toEqual(["file change"]);
    expect(element.textContent).not.toContain("Details");
    expect(textContents(element, ".codex-panel__output-title")).toEqual(["update src/main.ts", "Patch output"]);
  });

  it("derives file change summaries from changes and status instead of item text", () => {
    const block = threadStreamBlocks({
      turnLifecycle: runningTurnLifecycle("turn"),
      workspaceRoot: "/vault/project",
      items: [
        {
          id: "patch-1",
          kind: "fileChange",
          role: "tool",
          turnId: "turn",
          status: "failed",
          changes: [{ kind: "update", path: "/vault/project/src/main.ts", diff: "@@\n-old\n+new" }],
        },
      ],
    })[0];

    const element = renderThreadStreamBlockElement(block);

    expect(element.querySelector(".codex-panel__stream-summary")?.textContent).toBe("src/main.ts (failed)");
  });

  it("renders the edited files footer with an open diff action when aggregated turn diff exists", () => {
    const openTurnDiff = vi.fn();
    const blocks = threadStreamBlocks({
      workspaceRoot: "/vault/project",
      items: [
        {
          id: "patch-1",
          kind: "fileChange",
          role: "tool",
          turnId: "turn",
          status: "completed",
          changes: [{ kind: "update", path: "/vault/project/src/main.ts", diff: "@@\n-old\n+new" }],
        },
        {
          id: "a1",
          kind: "dialogue",
          role: "assistant",
          text: "Done",
          turnId: "turn",
          dialogueKind: "assistantResponse",
          dialogueState: "completed",
        },
      ],
      turnDiffs: new Map([["turn", "diff --git a/src/main.ts b/src/main.ts\n@@\n-old\n+new"]]),
      openTurnDiff,
    });

    const assistant = renderThreadStreamBlockElement(expectPresent(blocks.find((block) => block.key === "item:a1")));
    const button = assistant.querySelector<HTMLButtonElement>(".codex-panel__open-turn-diff");
    const summary = assistant.querySelector<HTMLElement>(".codex-panel__edited-files summary");

    expect(assistant.querySelector(".codex-panel__edited-files")?.textContent).toContain("Edited 1 file");
    expect(summary?.tabIndex).toBe(-1);
    expect(button?.getAttribute("aria-label")).toBe("View diff");
    expect(button?.tabIndex).toBe(0);
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
    const blocks = threadStreamBlocks({
      items: [
        {
          id: "u1",
          kind: "dialogue",
          dialogueKind: "user",
          role: "user",
          text: "この続きです",
          copyText: "この続きです",
          referencedThread: {
            threadId: "thread-reference",
            title: "参照元",
            includedTurns: 2,
            turnLimit: 20,
          },
        },
      ],
    });

    const user = renderThreadStreamBlockElement(expectPresent(blocks.find((block) => block.key === "item:u1")));

    expect(user.querySelector(".codex-panel__stream-item-content")?.textContent).toBe("この続きです");
    expect(user.querySelector(".codex-panel__referenced-thread")?.textContent).toContain("Referenced 参照元");
    expect(user.querySelector(".codex-panel__referenced-thread")?.textContent).toContain("2/20 turns");
    expect(user.querySelector<HTMLElement>(".codex-panel__referenced-thread")?.getAttribute("title")).toBeNull();
  });

  it("renders resolved file mentions as a collapsed user dialogue attachment", () => {
    const blocks = threadStreamBlocks({
      items: [
        {
          id: "u1",
          kind: "dialogue",
          dialogueKind: "user",
          role: "user",
          text: "Read [[Alpha]].",
          copyText: "Read [[Alpha]].",
          mentionedFiles: [{ name: "Alpha", path: "thoughts/Alpha.md" }],
        },
      ],
    });

    const user = renderThreadStreamBlockElement(expectPresent(blocks.find((block) => block.key === "item:u1")));
    const summary = user.querySelector<HTMLElement>(".codex-panel__context-items summary");

    expect(user.querySelector(".codex-panel__stream-item-content")?.textContent).toBe("Read [[Alpha]].");
    expect(summary?.textContent).toBe("Context · 1 item");
    expect(summary?.tabIndex).toBe(-1);
    expect(user.querySelector(".codex-panel__context-items")?.textContent).toContain("Alpha");
    expect(user.querySelector(".codex-panel__context-items")?.textContent).toContain("thoughts/Alpha.md");
  });

  it("includes web attachments in the collapsed user dialogue context", () => {
    const blocks = threadStreamBlocks({
      items: [
        {
          id: "u1",
          kind: "dialogue",
          dialogueKind: "user",
          role: "user",
          text: "https://example.com/ summarize this",
          copyText: "https://example.com/ summarize this",
          mentionedFiles: [{ name: "Alpha", path: "thoughts/Alpha.md" }],
          contextAttachments: [{ label: "Web page", detail: "https://example.com/" }],
        },
      ],
    });

    const user = renderThreadStreamBlockElement(expectPresent(blocks.find((block) => block.key === "item:u1")));
    const summary = user.querySelector<HTMLElement>(".codex-panel__context-items summary");

    expect(summary?.textContent).toBe("Context · 2 items");
    expect(user.querySelector(".codex-panel__context-items")?.textContent).toContain("Web page");
    expect(user.querySelector(".codex-panel__context-items")?.textContent).toContain("https://example.com/");
  });

  it("renders pending web submissions immediately as running user dialogue", () => {
    const pending = pendingWebSubmissionItem("local-web", "https://example.com", "summarize");
    if (!pending) throw new Error("Expected pending web submission");
    const blocks = threadStreamBlocks({ items: [pending] });

    const user = renderThreadStreamBlockElement(expectPresent(blocks.find((block) => block.key === "item:local-web")));

    expect(user.querySelector(".codex-panel__stream-item-content")?.textContent).toBe("https://example.com/ summarize");
    expect(user.querySelector(".codex-panel__context-items summary")?.textContent).toBe("Context · 1 item");
    expect(user.classList.contains("codex-panel__execution--running")).toBe(true);
  });

  it("does not render the open diff action without aggregated turn diff", () => {
    const blocks = threadStreamBlocks({
      items: [
        {
          id: "patch-1",
          kind: "fileChange",
          role: "tool",
          turnId: "turn",
          status: "completed",
          changes: [{ kind: "update", path: "src/main.ts", diff: "@@\n-old\n+new" }],
        },
        {
          id: "a1",
          kind: "dialogue",
          role: "assistant",
          text: "Done",
          turnId: "turn",
          dialogueKind: "assistantResponse",
          dialogueState: "completed",
        },
      ],
      openTurnDiff: vi.fn(),
    });

    const assistant = renderThreadStreamBlockElement(expectPresent(blocks.find((block) => block.key === "item:a1")));

    expect(assistant.querySelector(".codex-panel__edited-files")?.textContent).toContain("Edited 1 file");
    expect(assistant.querySelector(".codex-panel__open-turn-diff")).toBeNull();
  });
});
