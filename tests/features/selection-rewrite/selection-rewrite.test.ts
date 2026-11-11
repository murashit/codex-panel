// @vitest-environment jsdom

import * as fc from "fast-check";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EphemeralStructuredTurnRunner } from "../../../src/app-server/services/ephemeral-structured-turn";
import { createAppServerSelectionRewriteAdapter } from "../../../src/features/selection-rewrite/app-server-adapter";
import { buildSelectionDiffLines } from "../../../src/features/selection-rewrite/diff";
import type { SelectionRewriteInput } from "../../../src/features/selection-rewrite/model";
import {
  openSelectionRewritePopover,
  type SelectionRewritePopoverHandle,
  type SelectionRewritePopoverOptions,
} from "../../../src/features/selection-rewrite/popover.dom";
import { SelectionRewriteOutputError, type SelectionRewritePortRequest } from "../../../src/features/selection-rewrite/port";
import { positionSelectionRewritePopover } from "../../../src/features/selection-rewrite/position.dom";
import { buildSelectionRewritePrompt } from "../../../src/features/selection-rewrite/prompt";
import { appServerAgentMessageFixture as agentMessage, appServerCompletedTurnFixture as turn } from "../../support/app-server-records";
import { deferred } from "../../support/async";
import { changeInputValue, installObsidianDomShims } from "../../support/dom";

type SelectionRewriteTestRunOptions = SelectionRewritePortRequest & { runner: EphemeralStructuredTurnRunner };

const selectionRewriteGenerate = vi.fn();

installObsidianDomShims();

beforeEach(() => {
  document.body.replaceChildren();
  selectionRewriteGenerate.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("selection rewrite prompt", () => {
  it("uses fences that cannot be closed by note code blocks", () => {
    const prompt = buildSelectionRewritePrompt(
      rewriteInput({
        originalText: "```ts\nconst value = 1;\n```",
        noteText: "````markdown\n```ts\nconst value = 1;\n```\n````",
        targetRange: { from: { line: 1, ch: 0 }, to: { line: 3, ch: 3 } },
        selectionOffsets: { from: 13, to: 39 },
      }),
      "Make it clearer.",
    );

    expect(prompt).toContain("````text\n```ts");
    expect(prompt).toContain("`````text\n````markdown");
  });

  it("keeps the selected text in bounded note context regardless of its position", () => {
    const lengths = fc.oneof(
      fc.tuple(fc.integer({ min: 0, max: 20_000 }), fc.integer({ min: 20_000, max: 30_000 })),
      fc.tuple(fc.integer({ min: 20_000, max: 30_000 }), fc.integer({ min: 0, max: 20_000 })),
    );
    fc.assert(
      fc.property(lengths, ([before, after]) => {
        const selectedText = "SELECTED TEXT";
        const prompt = buildSelectionRewritePrompt(
          rewriteInput({
            noteText: `${"a".repeat(before)}${selectedText}${"z".repeat(after)}`,
            originalText: selectedText,
            targetRange: { from: { line: 0, ch: before }, to: { line: 0, ch: before + selectedText.length } },
            selectionOffsets: { from: before, to: before + selectedText.length },
          }),
          "Make it clearer.",
        );
        const context = prompt.match(/Current note context:\n```text\n([\s\S]*?)\n```\n\nReminder:/u)?.[1];

        expect(context).toBeDefined();
        expect(context).toContain(selectedText);
        expect(context?.length).toBeLessThanOrEqual(20_000);
      }),
    );
  });
});

describe("selection rewrite diff", () => {
  it("preserves both sides of a line diff across varied selections", () => {
    const line = fc.constantFrom("", "alpha", "β", "日本語", "a b", "↵", "+", "-");
    const nonEmptyLine = fc.constantFrom("alpha", "β", "日本語", "a b", "↵", "+", "-");
    const text = fc.oneof(
      fc.constant(""),
      fc.tuple(fc.array(line, { maxLength: 11 }), nonEmptyLine).map(([head, last]) => [...head, last].join("\n")),
    );

    fc.assert(
      fc.property(text, text, (original, replacement) => {
        const lines = buildSelectionDiffLines(original, replacement);
        expect(
          lines
            .filter((line) => line.kind !== "added")
            .map((line) => line.text.slice(1))
            .join("\n"),
        ).toBe(original);
        expect(
          lines
            .filter((line) => line.kind !== "removed")
            .map((line) => line.text.slice(1))
            .join("\n"),
        ).toBe(replacement);
      }),
    );
  });

  it("builds selection-scoped display lines", () => {
    expect(buildSelectionDiffLines("alpha\nbeta", "alpha\ngamma")).toEqual([
      { text: " alpha", kind: "context" },
      { text: "-beta", kind: "removed" },
      { text: "+gamma", kind: "added" },
    ]);
  });

  it("orders full replacement blocks as removals before additions", () => {
    const diff = buildSelectionDiffLines(
      "これはdiffのテストです。\n今日は元気です。\nとても元気です。",
      "これはdiffのてすとです。\nきょうはげんきです。\nとてもげんきです。",
    );

    expect(diff.map((line) => line.text).join("\n")).toContain(
      [
        "-これはdiffのテストです。",
        "-今日は元気です。",
        "-とても元気です。",
        "+これはdiffのてすとです。",
        "+きょうはげんきです。",
        "+とてもげんきです。",
      ].join("\n"),
    );
  });

  it("keeps accurate context for large selections with a small edit distance", () => {
    const commonBefore = Array.from({ length: 160 }, (_unused, index) => `common before ${String(index)}`);
    const commonAfter = Array.from({ length: 160 }, (_unused, index) => `common after ${String(index)}`);
    const originalText = ["same start", ...commonBefore, "old line", "shared middle", ...commonAfter, "same end"].join("\n");
    const replacementText = ["same start", ...commonBefore, "new line", "shared middle", ...commonAfter, "same end"].join("\n");

    const diff = buildSelectionDiffLines(originalText, replacementText)
      .map((line) => line.text)
      .join("\n");

    expect(diff).toContain("\n-old line\n+new line\n shared middle\n");
  });

  it("preserves both complete texts in high-edit-distance selection previews", () => {
    const originalText = [
      "same start",
      ...Array.from({ length: 160 }, (_unused, index) => `old before ${String(index)}`),
      "shared middle",
      ...Array.from({ length: 160 }, (_unused, index) => `old after ${String(index)}`),
      "same end",
    ].join("\n");
    const replacementText = [
      "same start",
      ...Array.from({ length: 160 }, (_unused, index) => `new before ${String(index)}`),
      "shared middle",
      ...Array.from({ length: 160 }, (_unused, index) => `new after ${String(index)}`),
      "same end",
    ].join("\n");

    const diff = buildSelectionDiffLines(originalText, replacementText);

    expect(
      diff
        .filter((line) => line.kind !== "added")
        .map((line) => line.text.slice(1))
        .join("\n"),
    ).toBe(originalText);
    expect(
      diff
        .filter((line) => line.kind !== "removed")
        .map((line) => line.text.slice(1))
        .join("\n"),
    ).toBe(replacementText);
  });

  it("shows a removed trailing line break", () => {
    expect(buildSelectionDiffLines("same\n", "same")).toEqual([
      { text: " same", kind: "context" },
      { text: "-↵", kind: "removed" },
    ]);
  });

  it("shows an added trailing line break", () => {
    expect(buildSelectionDiffLines("same", "same\n")).toEqual([
      { text: " same", kind: "context" },
      { text: "+↵", kind: "added" },
    ]);
    expect(buildSelectionDiffLines("", "\n")).toEqual([{ text: "+↵", kind: "added" }]);
  });
});

describe("selection rewrite positioning", () => {
  it.each([
    { name: "below the selection when it fits", anchor: [100, 100, 20, 20], size: [200, 120], expected: [100, 128] },
    {
      name: "above the selection and inside the right edge near the viewport bottom",
      anchor: [window.innerWidth - 20, window.innerHeight - 30, 20, 20],
      size: [200, 120],
      expected: [window.innerWidth - 208, window.innerHeight - 158],
    },
    { name: "inside the left edge for an offscreen anchor", anchor: [-20, 100, 20, 20], size: [200, 120], expected: [8, 128] },
    {
      name: "at the minimum margin when the popover exceeds the viewport",
      anchor: [100, 100, 20, 20],
      size: [window.innerWidth + 100, window.innerHeight + 100],
      expected: [8, 8],
    },
  ])("places the popover $name from supplied geometry", ({ anchor, size, expected }) => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    vi.spyOn(root, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, size[0], size[1]));
    vi.spyOn(window, "getSelection").mockReturnValue(null);
    const editor = {
      cm: { coordsAtPos: () => new DOMRect(anchor[0], anchor[1], anchor[2], anchor[3]) },
      getCursor: () => ({ line: 0, ch: 0 }),
      posToOffset: () => 0,
    };

    expect(positionSelectionRewritePopover(root, editor as never, window, 8)).toBe(true);
    expect(root.style.left).toBe(`${String(expected[0])}px`);
    expect(root.style.top).toBe(`${String(expected[1])}px`);
  });

  it("uses the target view window HTMLElement constructor for editor DOM checks", () => {
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    const viewWindow = expectPresent(frame.contentWindow);
    const viewDocument = expectPresent(frame.contentDocument);
    const root = viewDocument.createElement("div");
    viewDocument.body.appendChild(root);
    const editorDom = viewDocument.createElement("div");
    const editor = {
      cm: {
        dom: editorDom,
      },
      getCursor: () => ({ line: 0, ch: 0 }),
      posToOffset: () => 0,
    };

    expect(positionSelectionRewritePopover(root, editor as never, viewWindow, 8)).toBe(false);
  });
});

describe("selection rewrite app-server port", () => {
  it("maps the rewrite request, progress, and structured output through the runner", async () => {
    const activities: string[] = [];
    const previews: string[] = [];
    const signal = new AbortController().signal;
    const runner = vi.fn<EphemeralStructuredTurnRunner>(async (options) => {
      options.onProgress?.({ type: "reasoning-activity" });
      options.onProgress?.({ type: "agent-message-delta", delta: '{"replacementText":"stream' });
      options.onProgress?.({ type: "agent-message-delta", delta: 'ed"}' });
      return turn([agentMessage("answer", '{"replacementText":"final"}')]);
    });

    await expect(
      runSelectionRewrite({
        ...runOptions(runner),
        signal,
        runtimeSettings: { rewriteSelectionModel: "gpt-5.4-mini", rewriteSelectionEffort: "minimal" },
        onActivity: (activity) => activities.push(activity),
        onPreview: (text) => previews.push(text),
      }),
    ).resolves.toEqual({ replacementText: "final" });

    expect(activities).toEqual(["reasoning", "writing", "writing"]);
    expect(previews).toEqual(['{"replacementText":"stream', '{"replacementText":"streamed"}']);
    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({
        codexPath: "/bin/codex",
        cwd: "/vault",
        serviceName: "codex-panel-rewrite-selection",
        prompt: "Rewrite this.",
        outputSchema: {
          type: "object",
          properties: { replacementText: { type: "string" } },
          required: ["replacementText"],
          additionalProperties: false,
        },
        timeoutMs: 120_000,
        signal,
        runtimeSettings: { model: "gpt-5.4-mini", effort: "minimal" },
      }),
    );
  });

  it.each(["invalid raw output", '{"replacementText":42}'])(
    "reports invalid structured output with the raw assistant text: %s",
    async (rawText) => {
      const runner = vi.fn<EphemeralStructuredTurnRunner>(async () => turn([agentMessage("answer", rawText)]));

      await expect(runSelectionRewrite(runOptions(runner))).rejects.toMatchObject({ rawText });
    },
  );
});

describe("selection rewrite popover", () => {
  it("renders header-like selection content as edits and applies the original replacement", async () => {
    const editor = editorFixture("---");
    selectionRewriteGenerate.mockResolvedValue({ replacementText: "++ frontmatter\n" });
    openPopover(
      popoverOptions({
        editor: editor.editor,
        input: rewriteInput({
          originalText: "---",
          noteText: "---",
          targetRange: { from: { line: 0, ch: 0 }, to: { line: 0, ch: 3 } },
          selectionOffsets: { from: 0, to: 3 },
        }),
      }),
    );
    await act(async () => {
      expectPresent(document.querySelector<HTMLButtonElement>('button[aria-label="Generate"]')).click();
      await flushPromises();
    });

    expect(document.querySelector(".codex-panel-diff__line--removed")?.textContent).toBe("---");
    expect(Array.from(document.querySelectorAll(".codex-panel-diff__line--added"), (line) => line.textContent)).toEqual([
      "++ frontmatter",
      "↵",
    ]);
    void act(() => document.querySelector<HTMLButtonElement>('button[aria-label="Apply"]')?.click());
    expect(editor.replaceRange).toHaveBeenCalledWith("++ frontmatter\n", { line: 0, ch: 0 }, { line: 0, ch: 3 }, "codex-panel-rewrite");
  });

  it("generates from the Enter shortcut, renders a preview diff, and applies from the action shortcut", async () => {
    const editor = editorFixture();
    const rewrite = deferred<{ replacementText: string }>();
    selectionRewriteGenerate.mockImplementation((options: SelectionRewritePortRequest) => {
      options.onPreview("Partial rewrite");
      return rewrite.promise;
    });
    openPopover(popoverOptions({ editor: editor.editor }), "");
    const instruction = expectPresent(document.querySelector<HTMLTextAreaElement>(".codex-panel-selection-rewrite__instruction"));
    const generate = expectPresent(document.querySelector<HTMLButtonElement>('button[aria-label="Generate"]'));
    expect(generate.disabled).toBe(true);
    await act(async () => {
      instruction.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    });
    expect(selectionRewriteGenerate).not.toHaveBeenCalled();
    void act(() => {
      changeInputValue(instruction, "Make it concise.");
    });

    expect(generate.disabled).toBe(false);

    await act(async () => {
      instruction.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
      await Promise.resolve();
    });

    expect(instruction.disabled).toBe(true);
    expect(generate.disabled).toBe(true);
    expect(document.querySelector(".codex-panel-selection-rewrite__stream-preview")?.textContent).toBe("Partial rewrite");
    void act(() => generate.click());
    expect(selectionRewriteGenerate).toHaveBeenCalledOnce();
    await act(async () => rewrite.resolve({ replacementText: "Rewritten sentence." }));
    expect(document.querySelector(".codex-panel-selection-rewrite__diff")?.textContent).toContain("Rewritten sentence.");
    const apply = expectPresent(document.querySelector<HTMLButtonElement>('button[aria-label="Apply"]'));
    expect(apply.disabled).toBe(false);
    expect(document.activeElement).toBe(apply);

    await act(async () => {
      apply.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
      await Promise.resolve();
    });

    expect(editor.replaceRange).toHaveBeenCalledWith("Rewritten sentence.", { line: 2, ch: 0 }, { line: 2, ch: 21 }, "codex-panel-rewrite");
    expect(document.querySelector(".codex-panel-selection-rewrite")).toBeNull();
  });

  it("closes from outside pointerdown without closing internal controls", () => {
    openPopover(popoverOptions());
    const generate = expectPresent(document.querySelector<HTMLButtonElement>('button[aria-label="Generate"]'));
    void act(() => {
      generate.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    });

    expect(document.querySelector(".codex-panel-selection-rewrite")).not.toBeNull();

    void act(() => {
      document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    });

    expect(document.querySelector(".codex-panel-selection-rewrite")).toBeNull();
  });

  it.each(["resolve", "reject"])("aborts on Escape and ignores late progress and %s", async (outcome) => {
    const rewrite = deferred<{ replacementText: string }>();
    let signal: AbortSignal | undefined;
    selectionRewriteGenerate.mockImplementation((options: SelectionRewritePortRequest) => {
      signal = options.signal;
      return rewrite.promise.finally(() => {
        options.onActivity("reasoning");
        options.onPreview("Late preview");
      });
    });
    openPopover(popoverOptions());
    await act(async () => {
      expectPresent(document.querySelector<HTMLButtonElement>('button[aria-label="Generate"]')).click();
      await Promise.resolve();
    });

    void act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    });
    expect(signal?.aborted).toBe(true);
    expect(document.querySelector(".codex-panel-selection-rewrite")).toBeNull();

    if (outcome === "resolve") rewrite.resolve({ replacementText: "Late rewrite" });
    else rewrite.reject(new Error("Late failure"));
    await act(async () => {
      await flushPromises();
    });

    expect(document.querySelector(".codex-panel-selection-rewrite")).toBeNull();
  });

  it("uses mod-enter initially and plain Enter to regenerate a preview with a new instruction", async () => {
    selectionRewriteGenerate
      .mockResolvedValueOnce({ replacementText: "First rewrite." })
      .mockResolvedValueOnce({ replacementText: "Second rewrite." });
    const popover = openPopover(popoverOptions({ sendShortcut: "mod-enter" }));
    const instruction = expectPresent(document.querySelector<HTMLTextAreaElement>(".codex-panel-selection-rewrite__instruction"));
    await act(async () => {
      instruction.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    });
    expect(selectionRewriteGenerate).not.toHaveBeenCalled();
    await act(async () => {
      instruction.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter", ctrlKey: true }));
      await flushPromises();
    });
    expect(selectionRewriteGenerate).toHaveBeenCalledOnce();
    void act(() => {
      changeInputValue(instruction, "Try another version.");
    });
    await act(async () => {
      instruction.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
      await flushPromises();
    });

    expect(selectionRewriteGenerate).toHaveBeenCalledTimes(2);
    expect(selectionRewriteGenerate.mock.calls[1]?.[0].prompt).toContain("Try another version.");
    expect(document.querySelector(".codex-panel-selection-rewrite__diff")?.textContent).toContain("Second rewrite.");
    closePopover(popover);
  });

  it("retries after a failed generation and applies only the successful replacement", async () => {
    const editor = editorFixture();
    selectionRewriteGenerate
      .mockImplementationOnce(async (request) => {
        request.onPreview("Unfinished replacement");
        throw new SelectionRewriteOutputError("Invalid rewrite response.", "raw invalid output");
      })
      .mockResolvedValueOnce({ replacementText: "Recovered rewrite." });
    openPopover(popoverOptions({ editor: editor.editor }));
    await act(async () => {
      expectPresent(document.querySelector<HTMLButtonElement>('button[aria-label="Generate"]')).click();
      await flushPromises();
    });

    expect(document.body.textContent).toContain("Invalid rewrite response.");
    expect(document.body.textContent).toContain("raw invalid output");
    expect(document.querySelector(".codex-panel-selection-rewrite__stream-preview")?.textContent).toBe("");
    const apply = expectPresent(document.querySelector<HTMLButtonElement>('button[aria-label="Apply"]'));
    expect(apply.disabled).toBe(true);
    apply.click();
    expect(editor.replaceRange).not.toHaveBeenCalled();

    await act(async () => {
      expectPresent(document.querySelector<HTMLButtonElement>('button[aria-label="Generate"]')).click();
      await flushPromises();
    });

    expect(selectionRewriteGenerate).toHaveBeenCalledTimes(2);
    expect(document.querySelector(".codex-panel-selection-rewrite__diff")?.textContent).toContain("Recovered rewrite.");

    await act(async () => {
      expectPresent(document.querySelector<HTMLButtonElement>('button[aria-label="Apply"]')).click();
      await Promise.resolve();
    });

    expect(editor.replaceRange).toHaveBeenCalledWith("Recovered rewrite.", { line: 2, ch: 0 }, { line: 2, ch: 21 }, "codex-panel-rewrite");
  });

  it("restores the current draft after accidental instruction history navigation", async () => {
    const { popover, instruction } = await instructionHistoryPopover();

    void act(() => {
      instruction.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" }));
    });

    expect(instruction.value).toBe("History item two.");

    void act(() => {
      instruction.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
    });

    expect(instruction.value).toBe("Current draft.");

    closePopover(popover);
  });

  it("preserves edited instruction history drafts while navigating history", async () => {
    const { popover, instruction } = await instructionHistoryPopover();

    void act(() => {
      instruction.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" }));
      changeInputValue(instruction, "Edited history draft.");
      instruction.setSelectionRange(0, 0);
    });

    expect(instruction.value).toBe("Edited history draft.");

    void act(() => {
      instruction.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ctrlKey: true, key: "p" }));
    });

    expect(instruction.value).toBe("History item one.");

    void act(() => {
      instruction.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
    });

    expect(instruction.value).toBe("History item two.");

    void act(() => {
      instruction.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ctrlKey: true, key: "n" }));
    });

    expect(instruction.value).toBe("Edited history draft.");

    closePopover(popover);
  });

  it("records edited history items as new entries only when generated", async () => {
    selectionRewriteGenerate.mockResolvedValue({ replacementText: "Rewritten." });

    await generateInstructionHistoryItem("Rewrite as bullets.");

    const editingPopover = openPopover(popoverOptions(), "");
    const editingInstruction = expectPresent(document.querySelector<HTMLTextAreaElement>(".codex-panel-selection-rewrite__instruction"));

    void act(() => {
      editingInstruction.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" }));
      changeInputValue(editingInstruction, "Rewrite as numbered bullets.");
    });

    await act(async () => {
      expectPresent(document.querySelector<HTMLButtonElement>('button[aria-label="Generate"]')).click();
      await flushPromises();
    });

    closePopover(editingPopover);

    const historyPopover = openPopover(popoverOptions(), "");
    const historyInstruction = expectPresent(document.querySelector<HTMLTextAreaElement>(".codex-panel-selection-rewrite__instruction"));

    void act(() => {
      historyInstruction.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" }));
    });

    expect(historyInstruction.value).toBe("Rewrite as numbered bullets.");

    void act(() => {
      historyInstruction.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" }));
    });

    expect(historyInstruction.value).toBe("Rewrite as bullets.");

    closePopover(historyPopover);
  });
});

function rewriteInput(overrides: Partial<SelectionRewriteInput> = {}): SelectionRewriteInput {
  return {
    filePath: "Note.md",
    targetRange: { from: { line: 2, ch: 0 }, to: { line: 2, ch: 21 } },
    selectionOffsets: { from: 11, to: 32 },
    originalText: "Revise this sentence.",
    noteText: "# Heading\n\nRevise this sentence.\n\nNext paragraph.",
    ...overrides,
  };
}

function openPopover(options: SelectionRewritePopoverOptions, instructionText = "Make it clearer."): SelectionRewritePopoverHandle {
  let popover: SelectionRewritePopoverHandle | undefined;
  void act(() => {
    popover = openSelectionRewritePopover(options);
    const instruction = expectPresent(document.querySelector<HTMLTextAreaElement>(".codex-panel-selection-rewrite__instruction"));
    changeInputValue(instruction, instructionText);
  });
  return expectPresent(popover);
}

function closePopover(popover: SelectionRewritePopoverHandle): void {
  void act(() => popover.close());
}

async function generateInstructionHistoryItem(instructionText: string): Promise<void> {
  const popover = openPopover(popoverOptions(), instructionText);

  await act(async () => {
    expectPresent(document.querySelector<HTMLButtonElement>('button[aria-label="Generate"]')).click();
    await flushPromises();
  });

  closePopover(popover);
}

function popoverOptions(overrides: Partial<SelectionRewritePopoverOptions> = {}): SelectionRewritePopoverOptions {
  return {
    editor: editorFixture().editor,
    runtimeSettings: { rewriteSelectionModel: null, rewriteSelectionEffort: null },
    sendShortcut: "enter",
    input: rewriteInput(),
    port: {
      generate: (request) => selectionRewriteGenerate(request),
    },
    viewDocument: document,
    viewWindow: window,
    ...overrides,
  };
}

function editorFixture(currentText = "Revise this sentence.") {
  const replaceRange = vi.fn();
  return {
    editor: {
      getRange: () => currentText,
      replaceRange,
    } as unknown as SelectionRewritePopoverOptions["editor"],
    replaceRange,
  };
}

function expectPresent<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected value to be present");
  return value;
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function runSelectionRewrite(options: SelectionRewriteTestRunOptions) {
  const { runner, ...request } = options;
  return createAppServerSelectionRewriteAdapter({
    codexPath: "/bin/codex",
    cwd: "/vault",
    runner,
  }).generate(request);
}

function runOptions(runner: EphemeralStructuredTurnRunner): SelectionRewriteTestRunOptions {
  return {
    prompt: "Rewrite this.",
    runtimeSettings: { rewriteSelectionModel: null, rewriteSelectionEffort: null },
    onActivity: () => undefined,
    onPreview: () => undefined,
    signal: new AbortController().signal,
    runner,
  };
}

async function instructionHistoryPopover() {
  selectionRewriteGenerate.mockResolvedValue({ replacementText: "Rewritten." });

  await generateInstructionHistoryItem("History item one.");
  await generateInstructionHistoryItem("History item two.");

  const popover = openPopover(popoverOptions(), "Current draft.");
  const instruction = expectPresent(document.querySelector<HTMLTextAreaElement>(".codex-panel-selection-rewrite__instruction"));
  instruction.setSelectionRange(0, 0);
  return { popover, instruction };
}
