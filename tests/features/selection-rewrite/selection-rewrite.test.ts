// @vitest-environment jsdom

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildSelectionUnifiedDiff } from "../../../src/features/selection-rewrite/diff";
import {
  isSelectionRewriteActionKey,
  isSelectionRewriteGenerateKey,
  type SelectionRewriteGenerateKeyEvent,
} from "../../../src/features/selection-rewrite/keys";
import { canApplySelectionRewrite, type SelectionRewriteSession } from "../../../src/features/selection-rewrite/model";
import {
  parseSelectionRewriteOutput,
  selectionRewriteOutputFromTurn,
  selectionRewriteOutputParseResultFromTurn,
} from "../../../src/features/selection-rewrite/output";
import { SelectionRewritePopover } from "../../../src/features/selection-rewrite/popover";
import { buildSelectionRewritePrompt } from "../../../src/features/selection-rewrite/prompt";
import * as selectionRewriteRunner from "../../../src/features/selection-rewrite/runner";
import { selectionRewriteRuntime, validatedSelectionRewriteRuntime } from "../../../src/features/selection-rewrite/runner";
import type { Model } from "../../../src/generated/app-server/v2/Model";
import type { Turn } from "../../../src/generated/app-server/v2/Turn";
import { installObsidianDomShims } from "../chat/ui/dom-test-helpers";

installObsidianDomShims();

beforeEach(() => {
  Object.defineProperty(globalThis, "activeDocument", { configurable: true, value: document });
  Object.defineProperty(globalThis, "activeWindow", { configurable: true, value: window });
  document.body.replaceChildren();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("selection selection rewrite output", () => {
  it("parses valid selection rewrite JSON", () => {
    expect(parseSelectionRewriteOutput('{"replacementText":"rewritten"}')).toEqual({ replacementText: "rewritten" });
  });

  it("rejects invalid selection rewrite JSON", () => {
    expect(parseSelectionRewriteOutput("replacementText: rewritten")).toBeNull();
    expect(parseSelectionRewriteOutput('{"replacementText":42}')).toBeNull();
    expect(parseSelectionRewriteOutput('{"text":"rewritten"}')).toBeNull();
  });

  it("extracts the final selection rewrite JSON from a completed turn", () => {
    expect(
      selectionRewriteOutputFromTurn(
        turn([
          { type: "agentMessage", id: "a1", text: '{"replacementText":"first"}', phase: "final_answer", memoryCitation: null },
          { type: "agentMessage", id: "a2", text: '{"replacementText":"final"}', phase: "final_answer", memoryCitation: null },
        ]),
      ),
    ).toEqual({ replacementText: "final" });
  });

  it("keeps raw model text when selection rewrite output parsing fails", () => {
    expect(
      selectionRewriteOutputParseResultFromTurn(
        turn([{ type: "agentMessage", id: "a1", text: "replacementText: final", phase: "final_answer", memoryCitation: null }]),
      ),
    ).toEqual({ output: null, rawText: "replacementText: final" });
  });
});

describe("selection rewrite prompt", () => {
  it("always includes note context with the selected text", () => {
    const prompt = buildSelectionRewritePrompt(session());

    expect(prompt).toContain("Context mode: Selection + note context");
    expect(prompt).toContain("Current note context:");
    expect(prompt).toContain("# Heading");
  });

  it("uses fences that cannot be closed by note code blocks", () => {
    const prompt = buildSelectionRewritePrompt(
      session({
        originalText: "```ts\nconst value = 1;\n```",
        noteText: "````markdown\n```ts\nconst value = 1;\n```\n````",
      }),
    );

    expect(prompt).toContain("````text\n```ts");
    expect(prompt).toContain("`````text\n````markdown");
  });
});

describe("selection rewrite diff", () => {
  it("renders replacements in a selection-scoped unified diff", () => {
    const diff = buildSelectionUnifiedDiff("Note.md", "alpha\nbeta", "alpha\ngamma");

    expect(diff).toContain("diff --git a/Note.md b/Note.md");
    expect(diff).toContain("@@ -1,2 +1,2 @@");
    expect(diff).toContain(" alpha");
    expect(diff).toContain("-beta");
    expect(diff).toContain("+gamma");
  });

  it("orders full replacement blocks as removals before additions", () => {
    const diff = buildSelectionUnifiedDiff(
      "Note.md",
      "これはdiffのテストです。\n今日は元気です。\nとても元気です。",
      "これはdiffのてすとです。\nきょうはげんきです。\nとてもげんきです。",
    );

    expect(diff).toContain(
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

  it("renders additions and deletions", () => {
    expect(buildSelectionUnifiedDiff("Note.md", "", "added")).toContain("+added");
    expect(buildSelectionUnifiedDiff("Note.md", "removed", "")).toContain("-removed");
  });

  it("renders unchanged text as context", () => {
    expect(buildSelectionUnifiedDiff("Note.md", "same", "same")).toContain(" same");
  });
});

describe("selection rewrite apply guard", () => {
  it("allows apply only when the current range still matches the original text", () => {
    expect(canApplySelectionRewrite("original", "original")).toBe(true);
    expect(canApplySelectionRewrite("changed", "original")).toBe(false);
  });
});

describe("selection rewrite popover", () => {
  it("enables Generate only after the instruction has content", () => {
    const popover = new SelectionRewritePopover(popoverOptions({ session: session({ instruction: "" }) }));

    popover.open();

    const instruction = expectPresent(document.querySelector<HTMLTextAreaElement>(".codex-panel-selection-rewrite__instruction"));
    const generate = expectPresent(document.querySelector<HTMLButtonElement>('button[aria-label="Generate"]'));
    expect(generate.disabled).toBe(true);

    act(() => {
      setTextareaValue(instruction, "Make it concise.");
      instruction.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(generate.disabled).toBe(false);

    popover.close();
  });

  it("generates from the Enter shortcut, renders a preview diff, and applies from the action shortcut", async () => {
    const editor = editorFixture();
    const onClose = vi.fn();
    vi.spyOn(selectionRewriteRunner, "runSelectionRewrite").mockImplementation(async (options) => {
      options.onPreview?.("Rewritten sentence.");
      return { replacementText: "Rewritten sentence." };
    });
    const popover = new SelectionRewritePopover(popoverOptions({ editor: editor.editor, onClose, session: session({ instruction: "" }) }));

    popover.open();
    const instruction = expectPresent(document.querySelector<HTMLTextAreaElement>(".codex-panel-selection-rewrite__instruction"));
    act(() => {
      setTextareaValue(instruction, "Make it concise.");
      instruction.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      instruction.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
      await Promise.resolve();
    });

    expect(selectionRewriteRunner.runSelectionRewrite).toHaveBeenCalledOnce();
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

  it("unmounts and removes the React popover when closed", () => {
    const onClose = vi.fn();
    const popover = new SelectionRewritePopover(popoverOptions({ onClose }));

    popover.open();
    expect(document.querySelector(".codex-panel-selection-rewrite__instruction")).not.toBeNull();

    popover.close();

    expect(document.querySelector(".codex-panel-selection-rewrite")).toBeNull();
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("selection selection rewrite runtime", () => {
  it("uses explicit selection rewrite runtime settings", () => {
    expect(selectionRewriteRuntime({ rewriteSelectionModel: "gpt-5.4-mini", rewriteSelectionEffort: "minimal" })).toEqual({
      model: "gpt-5.4-mini",
      effort: "minimal",
    });
  });

  it("omits selection rewrite runtime overrides that are set to Codex default", () => {
    expect(selectionRewriteRuntime({ rewriteSelectionModel: null, rewriteSelectionEffort: null })).toEqual({});
  });

  it("omits an explicit selection rewrite effort when the selected model does not support it", () => {
    expect(
      validatedSelectionRewriteRuntime({ rewriteSelectionModel: "gpt-5.4-mini", rewriteSelectionEffort: "minimal" }, [
        model("gpt-5.4-mini", ["low", "medium", "high", "xhigh"]),
      ]),
    ).toEqual({ model: "gpt-5.4-mini" });
  });
});

describe("selection rewrite keys", () => {
  const baseEvent: SelectionRewriteGenerateKeyEvent = {
    key: "Enter",
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    isComposing: false,
  };

  it("generates on plain Enter in Enter mode", () => {
    expect(isSelectionRewriteGenerateKey(baseEvent, "enter")).toBe(true);
    expect(isSelectionRewriteGenerateKey({ ...baseEvent, shiftKey: true }, "enter")).toBe(false);
    expect(isSelectionRewriteGenerateKey({ ...baseEvent, metaKey: true }, "enter")).toBe(false);
  });

  it("generates on Cmd/Ctrl+Enter in mod-enter mode", () => {
    expect(isSelectionRewriteGenerateKey({ ...baseEvent, metaKey: true }, "mod-enter")).toBe(true);
    expect(isSelectionRewriteGenerateKey({ ...baseEvent, ctrlKey: true }, "mod-enter")).toBe(true);
    expect(isSelectionRewriteGenerateKey(baseEvent, "mod-enter")).toBe(false);
  });

  it("treats plain Enter and Cmd/Ctrl+Enter as preview action keys", () => {
    expect(isSelectionRewriteActionKey(baseEvent)).toBe(true);
    expect(isSelectionRewriteActionKey({ ...baseEvent, metaKey: true })).toBe(true);
    expect(isSelectionRewriteActionKey({ ...baseEvent, ctrlKey: true })).toBe(true);
    expect(isSelectionRewriteActionKey({ ...baseEvent, shiftKey: true })).toBe(false);
    expect(isSelectionRewriteActionKey({ ...baseEvent, isComposing: true })).toBe(false);
  });
});

function session(overrides: Partial<SelectionRewriteSession> = {}): SelectionRewriteSession {
  return {
    filePath: "Note.md",
    targetRange: {
      from: { line: 1, ch: 0 },
      to: { line: 1, ch: 22 },
    },
    originalText: "Revise this sentence.",
    noteText: "# Heading\n\nRevise this sentence.\n\nNext paragraph.",
    instruction: "Make it clearer.",
    status: "editing-prompt",
    streamText: "",
    replacementText: null,
    debugText: null,
    ...overrides,
  };
}

function popoverOptions(
  overrides: Partial<ConstructorParameters<typeof SelectionRewritePopover>[0]> = {},
): ConstructorParameters<typeof SelectionRewritePopover>[0] {
  return {
    codexPath: "/usr/local/bin/codex",
    cwd: "/vault",
    editor: editorFixture().editor,
    runtimeSettings: { rewriteSelectionModel: null, rewriteSelectionEffort: null },
    sendShortcut: "enter",
    session: session(),
    ...overrides,
  };
}

function editorFixture(): {
  editor: ConstructorParameters<typeof SelectionRewritePopover>[0]["editor"];
  replaceRange: ReturnType<typeof vi.fn>;
} {
  const replaceRange = vi.fn();
  return {
    editor: {
      getCursor: () => ({ line: 1, ch: 22 }),
      getRange: vi.fn(() => "Revise this sentence."),
      posToOffset: () => 0,
      replaceRange,
    } as unknown as ConstructorParameters<typeof SelectionRewritePopover>[0]["editor"],
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

function turn(items: Turn["items"], overrides: Partial<Turn> = {}): Turn {
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

function model(name: string, efforts: Model["supportedReasoningEfforts"][number]["reasoningEffort"][]): Model {
  return {
    id: name,
    model: name,
    upgrade: null,
    upgradeInfo: null,
    availabilityNux: null,
    displayName: name,
    description: "",
    hidden: false,
    supportedReasoningEfforts: efforts.map((reasoningEffort) => ({ reasoningEffort, description: "" })),
    defaultReasoningEffort: efforts[0] ?? "low",
    inputModalities: ["text"],
    supportsPersonality: false,
    additionalSpeedTiers: [],
    serviceTiers: [],
    defaultServiceTier: null,
    isDefault: false,
  };
}
