// @vitest-environment jsdom

import { MarkdownRenderer } from "obsidian";
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";
import { pendingWebSubmissionItem } from "../../../../../../src/features/chat/application/submission/web-submission";
import type { ThreadStreamItem } from "../../../../../../src/features/chat/domain/thread-stream/items";
import {
  renderStreamMarkdown,
  ThreadStreamMarkdownRenderer,
} from "../../../../../../src/features/chat/host/thread-stream/markdown-renderer.obsidian";
import { deferred } from "../../../../../support/async";
import { textContents, topLevelDetailsSummaries } from "../../../../../support/dom";
import { commandItemFixture } from "./fixtures";
import { setupThreadStreamRendering } from "./setup";

setupThreadStreamRendering();

import {
  expectPresent,
  projectedThreadStream,
  renderThreadStreamBlockElement,
  renderThreadStreamBlocksInAct,
  testDisclosures,
  unmountUiRootInAct,
  withStreamItemContentScrollHeight,
} from "./test-helpers";

describe("panel thread stream rendering and action menu", () => {
  it("retains the user message across acknowledgement while inserting completed work between messages", () => {
    const parent = document.createElement("div");

    renderThreadStreamBlocksInAct(
      parent,
      projectedThreadStream({
        items: [
          {
            id: "local-user",
            clientId: "prompt-client",
            kind: "dialogue",
            dialogueKind: "user",
            role: "user",
            text: "do it",
            turnId: "t1",
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
    const userNode = expectPresent(parent.querySelector(".codex-panel__stream-item"));
    renderThreadStreamBlocksInAct(
      parent,
      projectedThreadStream({
        items: [
          {
            id: "server-user",
            clientId: "prompt-client",
            kind: "dialogue",
            dialogueKind: "user",
            role: "user",
            text: "do it",
            turnId: "t1",
          },
          {
            id: "hook-1",
            kind: "hook",
            role: "tool",
            text: "userPromptSubmit: Saving jj baseline",
            toolName: "hook",
            turnId: "t1",
            statusLabel: "Completed",
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

    expect(parent.querySelector(".codex-panel__stream-item")).toBe(userNode);
    expect(textContents(parent, "[data-codex-panel-block-key]")).toEqual([
      expect.stringContaining("do it"),
      expect.stringContaining("Work details"),
      expect.stringContaining("done"),
    ]);
    const activitySummary = parent.querySelector<HTMLElement>(".codex-panel__activity-group summary");
    expect(activitySummary?.textContent).toBe("Work details");
    expect(activitySummary?.tabIndex).toBe(-1);
    unmountUiRootInAct(parent);
  });

  it("renders multiline review facts in one disclosure", () => {
    const { blocks, context } = projectedThreadStream({
      items: [
        {
          reviewKind: "automaticResult",
          id: "review-1",
          kind: "reviewResult",
          role: "tool",
          text: "Auto-review approved: apply patch (2 files)",
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
    });

    const element = renderThreadStreamBlockElement(expectPresent(blocks[0]), context);

    expect(element.classList.contains("codex-panel__execution--completed")).toBe(true);
    expect(textContents(element, "details summary")).toEqual(["auto-review"]);
    expect(textContents(element, ".codex-panel__meta-grid dt")).toEqual(["status", "action", "files"]);
    expect(textContents(element, ".codex-panel__meta-grid dd")).toEqual([
      "approved",
      "apply patch",
      "src/shared/ui/detail-view.ts\nsrc/shared/ui/thread-stream.ts",
    ]);
  });

  it("renders structured system result details as visible selectable meta rows", () => {
    const renderMarkdown = vi.fn((parent: HTMLElement, text: string) => parent.createDiv({ text: `markdown:${text}` }));
    const { blocks, context } = projectedThreadStream({
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
    });

    const element = renderThreadStreamBlockElement(expectPresent(blocks[0]), context);

    expect(element.classList.contains("codex-panel__stream-item--system")).toBe(true);
    expect(element.querySelector(".codex-panel__stream-item-content")?.textContent).toBe("Available slash commands");
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
    const { blocks, context } = projectedThreadStream({
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
    });

    const element = renderThreadStreamBlockElement(expectPresent(blocks[0]), context);

    expect(element.classList.contains("codex-panel__stream-item--tool")).toBe(true);
    expect(element.querySelector(".codex-panel__detail-label")?.textContent).toBe("goal");
    expect(element.querySelector(".codex-panel__stream-summary")?.textContent).toBe("set: Ship the feature");
    expect(element.querySelector("details")?.open).toBe(false);
    expect(element.querySelector(".codex-panel__meta-grid")?.textContent).toContain("actionset");
    expect(element.querySelector(".codex-panel__output-title")?.textContent).toBe("Objective");
    expect(element.querySelector("pre")?.textContent).toBe("Ship the feature");
  });

  it("renders rollback only for the eligible user dialogue", () => {
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
      { id: "u2", kind: "dialogue", dialogueKind: "user", role: "user", text: "latest", copyText: "latest", turnId: "turn-2" },
    ] as const;
    const { blocks, context } = projectedThreadStream({
      items: [...items],
      textActionTargetsByItemId: new Map([["u2", { rollback: true }]]),
      onRollback,
    });

    const rendered = blocks.map((block) => renderThreadStreamBlockElement(block, context));

    expect(expectPresent(rendered[0]).querySelector(".codex-panel__rollback-turn")).toBeNull();
    expect(expectPresent(rendered[1]).querySelector(".codex-panel__rollback-turn")).toBeNull();
    const button = expectPresent(rendered[2]).querySelector<HTMLButtonElement>(".codex-panel__rollback-turn");
    expect(button?.getAttribute("aria-label")).toBe("Roll back latest turn");
    button?.click();
    expect(onRollback).toHaveBeenCalledWith();
  });

  it("renders copy actions for copyable messages", () => {
    const copyText = vi.fn();
    const { blocks, context } = projectedThreadStream({
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

    const rendered = blocks.map((block) => renderThreadStreamBlockElement(block, context));
    const userButton = expectPresent(rendered[0]).querySelector<HTMLButtonElement>(".codex-panel__copy-dialogue");
    const assistantButton = expectPresent(rendered[1]).querySelector<HTMLButtonElement>(".codex-panel__copy-dialogue");

    expect(userButton?.getAttribute("aria-label")).toBe("Copy message");
    expect(assistantButton?.getAttribute("aria-label")).toBe("Copy message");
    userButton?.click();
    assistantButton?.click();
    expect(copyText).toHaveBeenNthCalledWith(1, "**user**");
    expect(copyText).toHaveBeenNthCalledWith(2, "# Answer");
  });

  it("expands assistant fork actions in the copy region and dispatches both fork choices", () => {
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

    const { blocks: closedBlocks, context: closedContext } = projectedThreadStream({
      items: [item],
      onForkMenuToggle,
      copyText: vi.fn(),
      textActionTargetsByItemId: new Map([["a1", { fork: { itemId: "a1", turnId: "turn-1" } }]]),
      onFork,
    });

    const closedElement = renderThreadStreamBlockElement(expectPresent(closedBlocks[0]), closedContext);
    expect(closedElement.querySelector(".codex-panel__copy-dialogue")).not.toBeNull();
    const initialFork = expectPresent(closedElement.querySelector<HTMLButtonElement>(".codex-panel__fork-dialogue"));
    expect(initialFork.getAttribute("aria-label")).toBe("Fork from here");
    expect(initialFork.getAttribute("data-icon")).toBe("lucide-split");
    initialFork.click();
    expect(onForkMenuToggle).toHaveBeenCalledWith("a1");

    const { blocks: openBlocks, context: openContext } = projectedThreadStream({
      items: [item],
      forkMenuItemId: "a1",
      onForkMenuToggle,
      copyText: vi.fn(),
      textActionTargetsByItemId: new Map([["a1", { fork: { itemId: "a1", turnId: "turn-1" } }]]),
      onFork,
    });

    const openElement = renderThreadStreamBlockElement(expectPresent(openBlocks[0]), openContext);
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(onForkMenuToggle).toHaveBeenLastCalledWith(null);
    expect(openElement.querySelector(".codex-panel__copy-dialogue")).toBeNull();
    expect(openElement.querySelector<HTMLButtonElement>(".codex-panel__fork-and-archive-dialogue")?.getAttribute("aria-label")).toBe(
      "Fork and archive",
    );
    const openFork = expectPresent(openElement.querySelector<HTMLButtonElement>(".codex-panel__fork-dialogue"));
    expect(openFork.getAttribute("aria-label")).toBe("Fork");
    expect(openFork.getAttribute("data-icon")).toBe("file-plus-corner");
    openFork.click();
    expect(onFork).toHaveBeenNthCalledWith(1, { itemId: "a1", turnId: "turn-1" }, false);
    expectPresent(openElement.querySelector<HTMLButtonElement>(".codex-panel__fork-and-archive-dialogue")).click();
    expect(onFork).toHaveBeenNthCalledWith(2, { itemId: "a1", turnId: "turn-1" }, true);
  });

  it("updates text item content when a streaming plan delta completes", () => {
    const parent = document.createElement("div");
    const baseContext = {
      renderMarkdown: (element: HTMLElement, text: string) => element.createDiv({ text: `markdown:${text}` }),
    };

    renderThreadStreamBlocksInAct(
      parent,
      projectedThreadStream({
        ...baseContext,
        items: [
          {
            id: "a1",
            kind: "dialogue",
            role: "assistant",
            text: "<proposed_plan>\n**answer** [[Note]]\n</proposed_plan>",
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
      projectedThreadStream({
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
    const markdownRenderer = markdownRendererFixture();
    const baseContext = {
      renderMarkdown: (element: HTMLElement, text: string) => {
        markdownRenderer.renderObsidianMarkdown(element, text);
      },
    };

    renderThreadStreamBlocksInAct(
      parent,
      projectedThreadStream({
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
      projectedThreadStream({
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
    const baseContext = {
      renderObsidianMarkdown: vi.fn(),
      renderStreamMarkdown: (element: HTMLElement, text: string) => renderStreamMarkdown(element, text),
    };

    renderThreadStreamBlocksInAct(
      parent,
      projectedThreadStream({
        ...baseContext,
        items: [
          {
            id: "a1",
            kind: "dialogue",
            role: "assistant",
            text: "**Streaming answer**",
            turnId: "turn-1",
            dialogueKind: "assistantResponse",
            dialogueState: "streaming",
          },
        ],
      }),
    );

    expect(parent.querySelector(".codex-panel__stream-item-content strong")?.textContent).toBe("Streaming answer");
    expect(baseContext.renderObsidianMarkdown).not.toHaveBeenCalled();
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
    const markdownRenderer = markdownRendererFixture();

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
      activeTurnId: "turn-1",
      items: [item],
      renderMarkdown: (parent: HTMLElement, text: string) => parent.createDiv({ text }),
      copyText: vi.fn(),
    };

    const { blocks: runningBlocks, context: runningContext } = projectedThreadStream(context);
    const { blocks: completedBlocks, context: completedContext } = projectedThreadStream({
      ...context,
      activeTurnId: null,
    });

    expect(
      renderThreadStreamBlockElement(expectPresent(runningBlocks[0]), runningContext).querySelector(".codex-panel__copy-dialogue"),
    ).toBeNull();
    expect(
      renderThreadStreamBlockElement(expectPresent(completedBlocks[0]), completedContext).querySelector(".codex-panel__copy-dialogue"),
    ).not.toBeNull();
  });

  it("does not render copy actions for tool items", () => {
    const { blocks, context } = projectedThreadStream({
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
    });

    expect(renderThreadStreamBlockElement(expectPresent(blocks[0]), context).querySelector(".codex-panel__copy-dialogue")).toBeNull();
  });

  it("collapses tall user dialogues without changing the copy payload", () => {
    withStreamItemContentScrollHeight(500, () => {
      const parent = document.createElement("div");
      const copyText = vi.fn();
      const onDisclosureToggle = vi.fn();
      const render = (expanded = false) => {
        const blocksProjection = projectedThreadStream({
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
          disclosures: testDisclosures({ userDialogueExpanded: expanded ? ["u1"] : [] }),
          onDisclosureToggle,
          copyText,
        });
        renderThreadStreamBlocksInAct(parent, blocksProjection);
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
      expect(onDisclosureToggle).toHaveBeenCalledWith("userDialogueExpanded", "u1", true);
      render(true);
      expect(content()?.classList.contains("codex-panel__stream-item-content--collapsed")).toBe(false);
      expect(details()?.hidden).toBe(true);

      void act(() => {
        document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      });
      expect(onDisclosureToggle).toHaveBeenCalledWith("userDialogueExpanded", "u1", false);
      render();
      expect(content()?.classList.contains("codex-panel__stream-item-content--collapsed")).toBe(true);
      expect(details()?.hidden).toBe(false);

      parent.querySelector<HTMLButtonElement>(".codex-panel__copy-dialogue")?.click();
      expect(copyText).toHaveBeenCalledWith("full copied text");
      unmountUiRootInAct(parent);
      parent.remove();
    });
  });

  it("does not show the collapse control for short user dialogues or assistant dialogues", () => {
    withStreamItemContentScrollHeight(120, () => {
      const { blocks: shortUserBlocks, context: shortUserContext } = projectedThreadStream({
        items: [{ id: "u1", kind: "dialogue", dialogueKind: "user", role: "user", text: "short", turnId: "turn-1" }],
      });
      const shortUser = renderThreadStreamBlockElement(expectPresent(shortUserBlocks[0]), shortUserContext);

      expect(shortUser.querySelector<HTMLDetailsElement>(".codex-panel__stream-item-collapse-details")?.hidden).toBe(true);
    });

    withStreamItemContentScrollHeight(500, () => {
      const { blocks: assistantBlocks, context: assistantContext } = projectedThreadStream({
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
      });
      const assistant = renderThreadStreamBlockElement(expectPresent(assistantBlocks[0]), assistantContext);

      expect(assistant.querySelector(".codex-panel__stream-item-collapse-details")).toBeNull();
    });
  });

  it("renders command items as a compact summary with output behind details", () => {
    const { blocks, context } = projectedThreadStream({
      activeTurnId: "turn",
      items: [
        commandItemFixture({
          statusLabel: "Failed",
          exitCode: 1,
          resultLabel: "exit 1",
          output: "stderr details",
        }),
      ],
    });

    const element = renderThreadStreamBlockElement(expectPresent(blocks[0]), context);

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
    const { blocks, context } = projectedThreadStream({
      activeTurnId: "turn",
      items: [
        commandItemFixture({
          statusLabel: "Running",
          output: "",
        }),
      ],
    });

    const element = renderThreadStreamBlockElement(expectPresent(blocks[0]), context);
    const metaText = element.querySelector(".codex-panel__meta-grid")?.textContent ?? "";

    expect(metaText).toContain("commandnpm run check");
    expect(metaText).toContain("statusRunning");
    expect(metaText).not.toContain("exit");
    expect(metaText).not.toContain("duration");
    expect(metaText).not.toContain("undefined");
  });

  it("derives command summaries from semantic targets instead of command text", () => {
    const { blocks, context } = projectedThreadStream({
      activeTurnId: "turn",
      items: [
        commandItemFixture({
          commandTarget: { kind: "search", query: "semantic target", path: "/vault/src" },
          command: "different raw command",
          statusLabel: "Completed",
          output: "results",
        }),
      ],
    });

    const element = renderThreadStreamBlockElement(expectPresent(blocks[0]), context);

    expect(element.querySelector(".codex-panel__stream-summary")?.textContent).toBe('"semantic target" in src');
  });

  it("renders file diffs inside a single file change details block", () => {
    const { blocks, context } = projectedThreadStream({
      activeTurnId: "turn",
      workspaceRoot: "/vault/project",
      items: [
        {
          id: "patch-1",
          kind: "fileChange",
          role: "tool",
          turnId: "turn",
          statusLabel: "Completed",
          changes: [{ kind: "update", path: "/vault/project/src/main.ts", diff: "@@\n-old\n+new" }],
          output: "patch applied",
        },
      ],
    });

    const element = renderThreadStreamBlockElement(expectPresent(blocks[0]), context);

    expect(element.querySelector(".codex-panel__stream-summary")?.textContent).toBe("src/main.ts");
    expect(topLevelDetailsSummaries(element)).toEqual(["file change"]);
    expect(textContents(element, "details summary")).toEqual(["file change"]);
    expect(element.textContent).not.toContain("Details");
    expect(textContents(element, ".codex-panel__output-title")).toEqual(["update src/main.ts", "Patch output"]);
  });

  it("renders the edited files footer with an open diff action when aggregated turn diff exists", () => {
    const openTurnDiff = vi.fn();
    const input = {
      workspaceRoot: "/vault/project",
      items: [
        {
          id: "patch-1",
          kind: "fileChange",
          role: "tool",
          turnId: "turn",
          statusLabel: "Completed",
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
      ] satisfies ThreadStreamItem[],
      turnDiffs: new Map([["turn", "diff --git a/src/main.ts b/src/main.ts\n@@\n-old\n+new"]]),
      openTurnDiff,
    };
    const { blocks, context } = projectedThreadStream(input);

    const assistant = renderThreadStreamBlockElement(expectPresent(blocks.find((block) => block.key === "item:a1")), context);
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
      files: ["src/main.ts"],
      diff: "diff --git a/src/main.ts b/src/main.ts\n@@\n-old\n+new",
    });

    const withoutDiff = projectedThreadStream({ ...input, turnDiffs: new Map() });
    const withoutDiffElement = renderThreadStreamBlockElement(
      expectPresent(withoutDiff.blocks.find((block) => block.key === "item:a1")),
      withoutDiff.context,
    );
    expect(withoutDiffElement.querySelector(".codex-panel__edited-files")?.textContent).toContain("Edited 1 file");
    expect(withoutDiffElement.querySelector(".codex-panel__open-turn-diff")).toBeNull();
  });

  it("combines file references and web attachments in collapsed user dialogue context", () => {
    const { blocks, context } = projectedThreadStream({
      items: [
        {
          id: "u1",
          kind: "dialogue",
          dialogueKind: "user",
          role: "user",
          text: "https://example.com/ summarize this",
          copyText: "https://example.com/ summarize this",
          referencedFiles: [{ name: "Alpha", path: "thoughts/Alpha.md" }],
          contextAttachments: [{ label: "Web page", detail: "https://example.com/" }],
        },
      ],
    });

    const user = renderThreadStreamBlockElement(expectPresent(blocks.find((block) => block.key === "item:u1")), context);
    const summary = user.querySelector<HTMLElement>(".codex-panel__context-items summary");

    expect(summary?.textContent).toBe("Context · 2 items");
    expect(summary?.tabIndex).toBe(-1);
    expect(user.querySelector(".codex-panel__context-items details")?.hasAttribute("open")).toBe(false);
    expect(user.querySelector(".codex-panel__context-items")?.textContent).toContain("Alpha");
    expect(user.querySelector(".codex-panel__context-items")?.textContent).toContain("thoughts/Alpha.md");
    expect(user.querySelector(".codex-panel__context-items")?.textContent).toContain("Web page");
    expect(user.querySelector(".codex-panel__context-items")?.textContent).toContain("https://example.com/");
  });

  it("renders pending web submissions immediately as running user dialogue", () => {
    const pending = pendingWebSubmissionItem("local-web", "https://example.com", "summarize");
    if (!pending) throw new Error("Expected pending web submission");
    const { blocks, context } = projectedThreadStream({ items: [pending] });

    const user = renderThreadStreamBlockElement(expectPresent(blocks.find((block) => block.key === "item:local-web")), context);

    expect(user.querySelector(".codex-panel__stream-item-content")?.textContent).toBe("https://example.com/ summarize");
    expect(user.querySelector(".codex-panel__context-items summary")?.textContent).toBe("Context · 1 item");
    expect(user.classList.contains("codex-panel__execution--running")).toBe(true);
  });
});

function markdownRendererFixture() {
  return new ThreadStreamMarkdownRenderer({
    app: { workspace: { getActiveFile: vi.fn(() => null) } } as never,
    owner: {} as never,
    openThread: vi.fn(),
  });
}
