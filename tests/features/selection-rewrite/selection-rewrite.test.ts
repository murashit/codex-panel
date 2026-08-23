// @vitest-environment jsdom

import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TurnRecord } from "../../../src/app-server/protocol/turn";
import type { EphemeralStructuredTurnRunner } from "../../../src/app-server/services/ephemeral-structured-turn";
import { createAppServerSelectionRewriteAdapter } from "../../../src/features/selection-rewrite/app-server-adapter";
import { buildSelectionDiffLines } from "../../../src/features/selection-rewrite/diff";
import {
  canApplySelectionRewrite,
  type SelectionRewriteState,
  selectionRewriteTextRangeOffsets,
} from "../../../src/features/selection-rewrite/model";
import { SelectionRewritePopover } from "../../../src/features/selection-rewrite/popover.dom";
import { SelectionRewriteOutputError, type SelectionRewritePortRequest } from "../../../src/features/selection-rewrite/port";
import { positionSelectionRewritePopover } from "../../../src/features/selection-rewrite/position.dom";
import { buildSelectionRewritePrompt } from "../../../src/features/selection-rewrite/prompt";
import { deferred } from "../../support/async";
import { installObsidianDomShims } from "../../support/dom";

type SelectionRewriteTestRunOptions = SelectionRewritePortRequest & { runner: EphemeralStructuredTurnRunner };

const selectionRewriteGenerate = vi.fn();

installObsidianDomShims();
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  document.body.replaceChildren();
  selectionRewriteGenerate.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("selection rewrite prompt", () => {
  it("always includes note context with the selected text", () => {
    const prompt = buildSelectionRewritePrompt(rewriteState());

    expect(prompt).toContain("Context mode: Selection + note context");
    expect(prompt).toContain("Current note context:");
    expect(prompt).toContain("# Heading");
  });

  it("uses fences that cannot be closed by note code blocks", () => {
    const prompt = buildSelectionRewritePrompt(
      rewriteState({
        originalText: "```ts\nconst value = 1;\n```",
        noteText: "````markdown\n```ts\nconst value = 1;\n```\n````",
      }),
    );

    expect(prompt).toContain("````text\n```ts");
    expect(prompt).toContain("`````text\n````markdown");
  });

  it("centers long note context around the selection", () => {
    const noteText = `START ONLY\n${"filler\n".repeat(4_000)}Near before\nRevise this sentence.\nNear after`;
    const prompt = buildSelectionRewritePrompt(
      rewriteState({
        noteText,
        targetRange: {
          from: { line: 4_002, ch: 0 },
          to: { line: 4_002, ch: 22 },
        },
      }),
    );

    expect(prompt).toContain("Near before");
    expect(prompt).toContain("Near after");
    expect(prompt).not.toContain("START ONLY");
  });
});

describe("selection rewrite diff", () => {
  it("builds selection-scoped display lines", () => {
    expect(buildSelectionDiffLines("alpha\nbeta", "alpha\ngamma")).toEqual([" alpha", "-beta", "+gamma"]);
  });

  it("orders full replacement blocks as removals before additions", () => {
    const diff = buildSelectionDiffLines(
      "これはdiffのテストです。\n今日は元気です。\nとても元気です。",
      "これはdiffのてすとです。\nきょうはげんきです。\nとてもげんきです。",
    );

    expect(diff.join("\n")).toContain(
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

    const diff = buildSelectionDiffLines(originalText, replacementText).join("\n");

    expect(diff).toContain("\n-old line\n+new line\n shared middle\n");
  });

  it("bounds high-edit-distance selection diffs with a linear prefix and suffix fallback", () => {
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

    const diff = buildSelectionDiffLines(originalText, replacementText).join("\n");

    expect(diff.startsWith(" same start\n")).toBe(true);
    expect(diff).toContain("\n-old before 0\n");
    expect(diff).toContain("\n-shared middle\n");
    expect(diff).toContain("\n+shared middle\n");
    expect(diff.endsWith("\n same end")).toBe(true);
    expect(diff).not.toContain("\n shared middle\n");
  });

  it("renders additions and deletions", () => {
    expect(buildSelectionDiffLines("", "added")).toContain("+added");
    expect(buildSelectionDiffLines("removed", "")).toContain("-removed");
  });

  it("renders unchanged text as context", () => {
    expect(buildSelectionDiffLines("same", "same")).toContain(" same");
  });
});

describe("selection rewrite apply guard", () => {
  it("allows apply only while the selected text still matches", () => {
    const state = rewriteState();
    expect(canApplySelectionRewrite("Revise this sentence.", state)).toBe(true);
    expect(canApplySelectionRewrite("Changed sentence.", state)).toBe(false);
  });

  it("converts a valid multi-line editor range to half-open text offsets", () => {
    expect(
      selectionRewriteTextRangeOffsets("first\nsecond line\nthird", {
        from: { line: 1, ch: 1 },
        to: { line: 1, ch: 7 },
      }),
    ).toEqual({ from: 7, to: 13 });
  });

  it("falls back to the expected text only when editor positions are invalid", () => {
    const invalidRange = {
      from: { line: 20, ch: 0 },
      to: { line: 20, ch: 4 },
    };

    expect(selectionRewriteTextRangeOffsets("before target after", invalidRange, "target")).toEqual({ from: 7, to: 13 });
    expect(selectionRewriteTextRangeOffsets("before target after", invalidRange, "missing")).toBeNull();
    expect(selectionRewriteTextRangeOffsets("before target after", invalidRange)).toBeNull();
  });

  it("rejects negative, reversed, and past-line-end editor ranges", () => {
    expect(selectionRewriteTextRangeOffsets("text", { from: { line: -1, ch: 0 }, to: { line: 0, ch: 1 } })).toBeNull();
    expect(selectionRewriteTextRangeOffsets("text", { from: { line: 0, ch: -1 }, to: { line: 0, ch: 1 } })).toBeNull();
    expect(selectionRewriteTextRangeOffsets("text", { from: { line: 0, ch: 3 }, to: { line: 0, ch: 1 } })).toBeNull();
    expect(selectionRewriteTextRangeOffsets("text", { from: { line: 0, ch: 0 }, to: { line: 0, ch: 5 } })).toBeNull();
    expect(selectionRewriteTextRangeOffsets("a\nlong", { from: { line: 0, ch: 0 }, to: { line: 0, ch: 2 } })).toBeNull();
  });

  it("accepts empty ranges at line boundaries and rejects an empty fallback", () => {
    expect(selectionRewriteTextRangeOffsets("text", { from: { line: 0, ch: 0 }, to: { line: 0, ch: 1 } })).toEqual({
      from: 0,
      to: 1,
    });
    expect(selectionRewriteTextRangeOffsets("text", { from: { line: 0, ch: 0 }, to: { line: 0, ch: 4 } })).toEqual({
      from: 0,
      to: 4,
    });
    expect(selectionRewriteTextRangeOffsets("a\n", { from: { line: 0, ch: 1 }, to: { line: 0, ch: 1 } })).toEqual({ from: 1, to: 1 });
    expect(selectionRewriteTextRangeOffsets("a\n", { from: { line: 1, ch: 0 }, to: { line: 1, ch: 0 } })).toEqual({ from: 2, to: 2 });
    expect(selectionRewriteTextRangeOffsets("text", { from: { line: 2, ch: 0 }, to: { line: 2, ch: 0 } }, "")).toBeNull();
  });
});

describe("selection rewrite positioning", () => {
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
        developerInstructions: expect.stringContaining("The only editable target is the selected text"),
        prompt: "Rewrite this.",
        outputSchema: {
          type: "object",
          properties: { replacementText: { type: "string" } },
          required: ["replacementText"],
          additionalProperties: false,
        },
        timeoutMs: 120_000,
        serverRequests: { kind: "reject", message: "Selection rewrite does not handle server requests." },
        abortMessage: "Selection rewrite cancelled.",
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
  it("enables Generate only after the instruction has content", () => {
    const popover = new SelectionRewritePopover(popoverOptions({ state: rewriteState({ instruction: "" }) }));

    openPopover(popover);

    const instruction = expectPresent(document.querySelector<HTMLTextAreaElement>(".codex-panel-selection-rewrite__instruction"));
    const generate = expectPresent(document.querySelector<HTMLButtonElement>('button[aria-label="Generate"]'));
    expect(generate.disabled).toBe(true);

    void act(() => {
      setTextareaValue(instruction, "Make it concise.");
      instruction.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(generate.disabled).toBe(false);

    closePopover(popover);
  });

  it("generates from the Enter shortcut, renders a preview diff, and applies from the action shortcut", async () => {
    const editor = editorFixture();
    const onClose = vi.fn();
    selectionRewriteGenerate.mockImplementation(async (options) => {
      options.onPreview?.("Rewritten sentence.");
      return { replacementText: "Rewritten sentence." };
    });
    const popover = new SelectionRewritePopover(
      popoverOptions({ editor: editor.editor, onClose, state: rewriteState({ instruction: "" }) }),
    );

    openPopover(popover);
    const instruction = expectPresent(document.querySelector<HTMLTextAreaElement>(".codex-panel-selection-rewrite__instruction"));
    expect(instruction.getAttribute("aria-label")).toBeNull();
    void act(() => {
      setTextareaValue(instruction, "Make it concise.");
      instruction.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      instruction.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
      await Promise.resolve();
    });

    expect(selectionRewriteGenerate).toHaveBeenCalledOnce();
    expect(document.querySelector(".codex-panel-selection-rewrite__diff")?.textContent).toContain("Rewritten sentence.");
    const apply = expectPresent(document.querySelector<HTMLButtonElement>('button[aria-label="Apply"]'));
    expect(apply.disabled).toBe(false);

    await act(async () => {
      apply.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
      await Promise.resolve();
    });

    expect(editor.replaceRange).toHaveBeenCalledWith("Rewritten sentence.", { line: 1, ch: 0 }, { line: 1, ch: 22 }, "codex-panel-rewrite");
    expect(document.querySelector(".codex-panel-selection-rewrite")).toBeNull();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("refuses to apply when the current editor range no longer matches the original selection", async () => {
    const editor = editorFixture({ currentText: "Changed sentence." });
    const popover = new SelectionRewritePopover(
      popoverOptions({
        editor: editor.editor,
        state: rewriteState({ status: "preview", replacementText: "Rewritten sentence." }),
      }),
    );

    openPopover(popover);
    await act(async () => {
      expectPresent(document.querySelector<HTMLButtonElement>('button[aria-label="Apply"]')).click();
      await Promise.resolve();
    });

    expect(editor.getRange).toHaveBeenCalledWith({ line: 1, ch: 0 }, { line: 1, ch: 22 });
    expect(editor.replaceRange).not.toHaveBeenCalled();
    expect(document.querySelector(".codex-panel-selection-rewrite")).not.toBeNull();
    expect(document.body.textContent).toContain("Selection changed. Generate the rewrite again before applying.");

    closePopover(popover);
  });

  it("unmounts and removes the Preact popover when closed", () => {
    const onClose = vi.fn();
    const popover = new SelectionRewritePopover(popoverOptions({ onClose }));

    openPopover(popover);
    expect(document.querySelector(".codex-panel-selection-rewrite__instruction")).not.toBeNull();
    expect(document.querySelector<HTMLButtonElement>('button[aria-label="Cancel"]')).toBeNull();

    closePopover(popover);

    expect(document.querySelector(".codex-panel-selection-rewrite")).toBeNull();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes from outside pointerdown without closing internal controls", () => {
    const onClose = vi.fn();
    const popover = new SelectionRewritePopover(popoverOptions({ onClose }));

    openPopover(popover);
    const generate = expectPresent(document.querySelector<HTMLButtonElement>('button[aria-label="Generate"]'));
    void act(() => {
      generate.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    });

    expect(document.querySelector(".codex-panel-selection-rewrite")).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    void act(() => {
      document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    });

    expect(document.querySelector(".codex-panel-selection-rewrite")).toBeNull();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("aborts the active generation when closed and ignores its late result", async () => {
    const rewrite = deferred<{ replacementText: string }>();
    let signal: AbortSignal | undefined;
    selectionRewriteGenerate.mockImplementation((options) => {
      signal = options.signal;
      return rewrite.promise;
    });
    const popover = new SelectionRewritePopover(popoverOptions());

    openPopover(popover);
    await act(async () => {
      expectPresent(document.querySelector<HTMLButtonElement>('button[aria-label="Generate"]')).click();
      await Promise.resolve();
    });

    closePopover(popover);
    expect(signal?.aborted).toBe(true);

    rewrite.resolve({ replacementText: "Late rewrite" });
    await act(async () => {
      await flushPromises();
    });

    expect(document.querySelector(".codex-panel-selection-rewrite")).toBeNull();
    expect(document.body.textContent).not.toContain("Late rewrite");
  });

  it("keeps only one generation run active while a rewrite is pending", async () => {
    const rewrite = deferred<{ replacementText: string }>();
    selectionRewriteGenerate.mockReturnValue(rewrite.promise);
    const popover = new SelectionRewritePopover(popoverOptions());

    openPopover(popover);
    const generate = expectPresent(document.querySelector<HTMLButtonElement>('button[aria-label="Generate"]'));
    await act(async () => {
      generate.click();
      generate.click();
      await Promise.resolve();
    });

    expect(selectionRewriteGenerate).toHaveBeenCalledOnce();

    rewrite.resolve({ replacementText: "Rewritten once." });
    await act(async () => {
      await flushPromises();
    });

    expect(document.querySelector(".codex-panel-selection-rewrite__diff")?.textContent).toContain("Rewritten once.");
  });

  it("regenerates from a preview with a new instruction", async () => {
    selectionRewriteGenerate
      .mockResolvedValueOnce({ replacementText: "First rewrite." })
      .mockResolvedValueOnce({ replacementText: "Second rewrite." });
    const popover = new SelectionRewritePopover(popoverOptions());

    openPopover(popover);
    await act(async () => {
      expectPresent(document.querySelector<HTMLButtonElement>('button[aria-label="Generate"]')).click();
      await flushPromises();
    });
    const instruction = expectPresent(document.querySelector<HTMLTextAreaElement>(".codex-panel-selection-rewrite__instruction"));
    void act(() => {
      setTextareaValue(instruction, "Try another version.");
      instruction.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      expectPresent(document.querySelector<HTMLButtonElement>('button[aria-label="Regenerate"]')).click();
      await flushPromises();
    });

    expect(selectionRewriteGenerate).toHaveBeenCalledTimes(2);
    expect(document.querySelector(".codex-panel-selection-rewrite__diff")?.textContent).toContain("Second rewrite.");
    closePopover(popover);
  });

  it("retries after a failed generation and applies only the successful replacement", async () => {
    const editor = editorFixture();
    selectionRewriteGenerate
      .mockRejectedValueOnce(new SelectionRewriteOutputError("Invalid rewrite response.", "raw invalid output"))
      .mockResolvedValueOnce({ replacementText: "Recovered rewrite." });
    const popover = new SelectionRewritePopover(popoverOptions({ editor: editor.editor }));

    openPopover(popover);
    await act(async () => {
      expectPresent(document.querySelector<HTMLButtonElement>('button[aria-label="Generate"]')).click();
      await flushPromises();
    });

    expect(document.body.textContent).toContain("Invalid rewrite response.");
    expect(document.body.textContent).toContain("raw invalid output");

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

    expect(editor.replaceRange).toHaveBeenCalledWith("Recovered rewrite.", { line: 1, ch: 0 }, { line: 1, ch: 22 }, "codex-panel-rewrite");
  });

  it("restores the current draft after accidental instruction history navigation", async () => {
    selectionRewriteGenerate.mockResolvedValue({ replacementText: "Rewritten." });

    await generateInstructionHistoryItem("History item one.");
    await generateInstructionHistoryItem("History item two.");

    const popover = new SelectionRewritePopover(popoverOptions({ state: rewriteState({ instruction: "Current draft." }) }));
    openPopover(popover);
    const instruction = expectPresent(document.querySelector<HTMLTextAreaElement>(".codex-panel-selection-rewrite__instruction"));
    instruction.setSelectionRange(0, 0);

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
    selectionRewriteGenerate.mockResolvedValue({ replacementText: "Rewritten." });

    await generateInstructionHistoryItem("History item one.");
    await generateInstructionHistoryItem("History item two.");

    const popover = new SelectionRewritePopover(popoverOptions({ state: rewriteState({ instruction: "Current draft." }) }));
    openPopover(popover);
    const instruction = expectPresent(document.querySelector<HTMLTextAreaElement>(".codex-panel-selection-rewrite__instruction"));
    instruction.setSelectionRange(0, 0);

    void act(() => {
      instruction.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" }));
      setTextareaValue(instruction, "Edited history draft.");
      instruction.dispatchEvent(new Event("input", { bubbles: true }));
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

    const editingPopover = new SelectionRewritePopover(popoverOptions({ state: rewriteState({ instruction: "" }) }));
    openPopover(editingPopover);
    const editingInstruction = expectPresent(document.querySelector<HTMLTextAreaElement>(".codex-panel-selection-rewrite__instruction"));

    void act(() => {
      editingInstruction.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" }));
      setTextareaValue(editingInstruction, "Rewrite as numbered bullets.");
      editingInstruction.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      expectPresent(document.querySelector<HTMLButtonElement>('button[aria-label="Generate"]')).click();
      await flushPromises();
    });

    closePopover(editingPopover);

    const historyPopover = new SelectionRewritePopover(popoverOptions({ state: rewriteState({ instruction: "" }) }));
    openPopover(historyPopover);
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

function rewriteState(overrides: Partial<SelectionRewriteState> = {}): SelectionRewriteState {
  return {
    filePath: "Note.md",
    targetRange: {
      from: { line: 1, ch: 0 },
      to: { line: 1, ch: 22 },
    },
    originalText: "Revise this sentence.",
    noteText: "# Heading\n\nRevise this sentence.\n\nNext paragraph.",
    instruction: "Make it clearer.",
    status: "editing",
    streamText: "",
    replacementText: null,
    debugText: null,
    ...overrides,
  } as SelectionRewriteState;
}

function openPopover(popover: SelectionRewritePopover): void {
  void act(() => {
    popover.open();
  });
}

function closePopover(popover: SelectionRewritePopover): void {
  void act(() => {
    popover.close();
  });
}

async function generateInstructionHistoryItem(instructionText: string): Promise<void> {
  const popover = new SelectionRewritePopover(popoverOptions({ state: rewriteState({ instruction: "" }) }));
  openPopover(popover);
  const instruction = expectPresent(document.querySelector<HTMLTextAreaElement>(".codex-panel-selection-rewrite__instruction"));

  void act(() => {
    setTextareaValue(instruction, instructionText);
    instruction.dispatchEvent(new Event("input", { bubbles: true }));
  });

  await act(async () => {
    expectPresent(document.querySelector<HTMLButtonElement>('button[aria-label="Generate"]')).click();
    await flushPromises();
  });

  closePopover(popover);
}

function popoverOptions(
  overrides: Partial<ConstructorParameters<typeof SelectionRewritePopover>[0]> = {},
): ConstructorParameters<typeof SelectionRewritePopover>[0] {
  return {
    editor: editorFixture().editor,
    runtimeSettings: { rewriteSelectionModel: null, rewriteSelectionEffort: null },
    sendShortcut: "enter",
    state: rewriteState(),
    port: {
      generate: (request) => selectionRewriteGenerate(request),
    },
    viewDocument: document,
    viewWindow: window,
    ...overrides,
  };
}

function editorFixture(options: { currentText?: string; currentNoteText?: string } = {}): {
  editor: ConstructorParameters<typeof SelectionRewritePopover>[0]["editor"];
  getRange: ReturnType<typeof vi.fn>;
  getValue: ReturnType<typeof vi.fn>;
  replaceRange: ReturnType<typeof vi.fn>;
} {
  const getRange = vi.fn(() => options.currentText ?? "Revise this sentence.");
  const getValue = vi.fn(() => options.currentNoteText ?? rewriteState().noteText);
  const replaceRange = vi.fn();
  return {
    editor: {
      getCursor: () => ({ line: 1, ch: 22 }),
      getRange,
      getValue,
      posToOffset: () => 0,
      replaceRange,
    } as unknown as ConstructorParameters<typeof SelectionRewritePopover>[0]["editor"],
    getRange,
    getValue,
    replaceRange,
  };
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
  if (!descriptor?.set) throw new Error("Expected textarea value setter.");
  const setValue = descriptor.set.bind(textarea) as (nextValue: string) => void;
  setValue(value);
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

function turn(items: TurnRecord["items"], overrides: Partial<TurnRecord> = {}): TurnRecord {
  return {
    id: "turn",
    items,
    itemsView: "full",
    status: "completed",
    error: null,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    ...overrides,
  };
}

function agentMessage(id: string, text: string): Extract<TurnRecord["items"][number], { type: "agentMessage" }> {
  return { type: "agentMessage", id, text, phase: "final_answer", memoryCitation: null, delivery: null };
}
