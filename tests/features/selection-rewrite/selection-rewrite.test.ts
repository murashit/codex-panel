// @vitest-environment jsdom

import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildSelectionUnifiedDiff } from "../../../src/features/selection-rewrite/diff";
import {
  canApplySelectionRewrite,
  transitionSelectionRewriteState,
  type SelectionRewriteState,
} from "../../../src/features/selection-rewrite/model";
import {
  parseSelectionRewriteOutput,
  selectionRewriteOutputFromText,
  selectionRewriteOutputParseResultFromText,
} from "../../../src/features/selection-rewrite/output";
import { isSelectionRewriteActionKey, SelectionRewritePopover } from "../../../src/features/selection-rewrite/popover";
import { buildSelectionRewritePrompt } from "../../../src/features/selection-rewrite/prompt";
import * as selectionRewriteRunner from "../../../src/features/selection-rewrite/runner";
import {
  runSelectionRewrite,
  selectionRewriteRuntimeOverride,
  validatedSelectionRewriteRuntimeOverride,
  type SelectionRewriteClient,
  type SelectionRewriteClientFactory,
} from "../../../src/features/selection-rewrite/runner";
import type {
  AppServerClient,
  AppServerClientHandlers,
  AppServerStartStructuredTurnOptions,
} from "../../../src/app-server/connection/client";
import type { RequestId, ServerNotification } from "../../../src/app-server/connection/rpc-messages";
import type { TurnItem, TurnRecord } from "../../../src/app-server/protocol/turn";
import type { ModelMetadata, ReasoningEffort } from "../../../src/domain/catalog/metadata";
import type { ServerInitialization } from "../../../src/domain/server/initialization";
import type { ComposerSendKeyEvent } from "../../../src/shared/ui/keyboard";
import { deferred } from "../../support/async";
import { installObsidianDomShims } from "../../support/dom";

type InitializeResponse = ServerInitialization;
type ModelListResponse = Awaited<ReturnType<AppServerClient["listModels"]>>;
type ThreadStartResponse = Awaited<ReturnType<AppServerClient["startEphemeralThread"]>>;
type Turn = TurnRecord;
type TurnStartResponse = Awaited<ReturnType<AppServerClient["startStructuredTurn"]>>;

installObsidianDomShims();
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

  it("parses selection rewrite output text", () => {
    expect(selectionRewriteOutputFromText('{"replacementText":"final"}')).toEqual({ replacementText: "final" });
  });

  it("keeps raw model text when selection rewrite output parsing fails", () => {
    expect(selectionRewriteOutputParseResultFromText("replacementText: final")).toEqual({
      output: null,
      rawText: "replacementText: final",
    });
  });
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

describe("selection rewrite lifecycle", () => {
  it("transitions through generation and preview states", () => {
    const generating = transitionSelectionRewriteState(rewriteState({ replacementText: "old", debugText: "old debug" }), {
      type: "generation-started",
      instruction: "Shorten it.",
    });

    expect(generating).toMatchObject({
      instruction: "Shorten it.",
      status: "generating",
      streamText: "",
      replacementText: null,
      debugText: null,
    });

    const streaming = transitionSelectionRewriteState(generating, { type: "preview-updated", text: "New" });
    expect(streaming.streamText).toBe("New");

    const preview = transitionSelectionRewriteState(streaming, { type: "generation-succeeded", replacementText: "New text." });
    expect(preview).toMatchObject({
      status: "preview",
      streamText: "",
      replacementText: "New text.",
    });
  });

  it("ignores stale generation callbacks after generation is no longer active", () => {
    const state = rewriteState({ status: "cancelled", streamText: "" });

    expect(transitionSelectionRewriteState(state, { type: "generation-started", instruction: "late" })).toBe(state);
    expect(transitionSelectionRewriteState(state, { type: "preview-updated", text: "late" })).toBe(state);
    expect(transitionSelectionRewriteState(state, { type: "generation-succeeded", replacementText: "late" })).toBe(state);
    expect(transitionSelectionRewriteState(state, { type: "generation-failed", debugText: "late" })).toBe(state);
  });

  it("marks terminal user actions explicitly", () => {
    expect(transitionSelectionRewriteState(rewriteState(), { type: "cancelled" }).status).toBe("cancelled");
    expect(transitionSelectionRewriteState(rewriteState({ replacementText: "New text." }), { type: "applied" }).status).toBe("applied");
  });
});

describe("selection rewrite runner lifecycle", () => {
  it("keeps pre-acknowledgement completion when turn notifications arrive before turn/start resolves", async () => {
    const { clientFactory, client } = fakeSelectionRewriteClientFactory((fake) => {
      fake.startStructuredTurnImpl = async () => {
        fake.emit(completedItemNotification("thread", "turn", agentMessage("answer", '{"replacementText":"early"}')));
        fake.emit(turnCompletedNotification("thread", turn([], { id: "turn", status: "completed" })));
        return { turn: turn([], { id: "turn", status: "inProgress" }) };
      };
    });

    await expect(runSelectionRewrite(runOptions(clientFactory))).resolves.toEqual({ replacementText: "early" });
    expect(client.current?.disconnected).toBe(true);
  });

  it("ignores notifications outside the active selection rewrite turn", async () => {
    const previews: string[] = [];
    const { clientFactory, client } = fakeSelectionRewriteClientFactory();
    const rewriting = runSelectionRewrite({
      ...runOptions(clientFactory),
      onPreview: (text) => previews.push(text),
    });

    await expectPresent(client.current).structuredTurnStarted;
    await Promise.resolve();

    const fake = expectPresent(client.current);
    fake.emit(agentDeltaNotification("other-thread", "turn", "ignored"));
    fake.emit(completedItemNotification("thread", "other-turn", agentMessage("wrong", '{"replacementText":"wrong"}')));
    fake.emit(agentDeltaNotification("thread", "turn", '{"replacementText":"stream'));
    fake.emit(agentDeltaNotification("thread", "turn", 'ed"}'));
    fake.emit(completedItemNotification("thread", "turn", agentMessage("answer", '{"replacementText":"final"}')));
    fake.emit(turnCompletedNotification("thread", turn([], { id: "turn", status: "completed" })));

    await expect(rewriting).resolves.toEqual({ replacementText: "final" });
    expect(previews).toEqual(['{"replacementText":"stream', '{"replacementText":"streamed"}']);
  });
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
    vi.spyOn(selectionRewriteRunner, "runSelectionRewrite").mockImplementation(async (options) => {
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
    vi.spyOn(selectionRewriteRunner, "runSelectionRewrite").mockImplementation((options) => {
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

  it("ignores late generation preview callbacks after close", async () => {
    const rewrite = deferred<{ replacementText: string }>();
    const options = popoverOptions();
    const preview: { current: ((text: string) => void) | null } = { current: null };
    vi.spyOn(selectionRewriteRunner, "runSelectionRewrite").mockImplementation((runOptions) => {
      preview.current = runOptions.onPreview ?? null;
      return rewrite.promise;
    });
    const popover = new SelectionRewritePopover(options);

    openPopover(popover);
    await act(async () => {
      expectPresent(document.querySelector<HTMLButtonElement>('button[aria-label="Generate"]')).click();
      await Promise.resolve();
    });

    closePopover(popover);
    const latePreview = preview.current;
    if (!latePreview) throw new Error("Expected preview callback to be captured");
    latePreview("Late partial");

    expect(options.state.streamText).toBe("");

    rewrite.resolve({ replacementText: "Late rewrite" });
    await act(async () => {
      await flushPromises();
    });
  });

  it("keeps only one generation run active while a rewrite is pending", async () => {
    const rewrite = deferred<{ replacementText: string }>();
    vi.spyOn(selectionRewriteRunner, "runSelectionRewrite").mockReturnValue(rewrite.promise);
    const popover = new SelectionRewritePopover(popoverOptions());

    openPopover(popover);
    const generate = expectPresent(document.querySelector<HTMLButtonElement>('button[aria-label="Generate"]'));
    await act(async () => {
      generate.click();
      generate.click();
      await Promise.resolve();
    });

    expect(selectionRewriteRunner.runSelectionRewrite).toHaveBeenCalledOnce();

    rewrite.resolve({ replacementText: "Rewritten once." });
    await act(async () => {
      await flushPromises();
    });

    expect(document.querySelector(".codex-panel-selection-rewrite__diff")?.textContent).toContain("Rewritten once.");
  });

  it("restores the current draft after accidental instruction history navigation", async () => {
    vi.spyOn(selectionRewriteRunner, "runSelectionRewrite").mockResolvedValue({ replacementText: "Rewritten." });

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
    vi.spyOn(selectionRewriteRunner, "runSelectionRewrite").mockResolvedValue({ replacementText: "Rewritten." });

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
    vi.spyOn(selectionRewriteRunner, "runSelectionRewrite").mockResolvedValue({ replacementText: "Rewritten." });

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

describe("selection rewrite runtime overrides", () => {
  it("uses explicit selection rewrite runtime overrides", () => {
    expect(selectionRewriteRuntimeOverride({ rewriteSelectionModel: "gpt-5.4-mini", rewriteSelectionEffort: "minimal" })).toEqual({
      model: "gpt-5.4-mini",
      effort: "minimal",
    });
  });

  it("omits selection rewrite runtime overrides that are set to Codex default", () => {
    expect(selectionRewriteRuntimeOverride({ rewriteSelectionModel: null, rewriteSelectionEffort: null })).toEqual({});
  });

  it("omits an explicit selection rewrite effort when the selected model does not support it", () => {
    expect(
      validatedSelectionRewriteRuntimeOverride({ rewriteSelectionModel: "gpt-5.4-mini", rewriteSelectionEffort: "minimal" }, [
        modelMetadata("gpt-5.4-mini", ["low", "medium", "high", "xhigh"]),
      ]),
    ).toEqual({ model: "gpt-5.4-mini" });
  });
});

describe("selection rewrite keys", () => {
  const baseEvent: ComposerSendKeyEvent = {
    key: "Enter",
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    isComposing: false,
  };

  it("treats plain Enter and Cmd/Ctrl+Enter as preview action keys", () => {
    expect(isSelectionRewriteActionKey(baseEvent)).toBe(true);
    expect(isSelectionRewriteActionKey({ ...baseEvent, metaKey: true })).toBe(true);
    expect(isSelectionRewriteActionKey({ ...baseEvent, ctrlKey: true })).toBe(true);
    expect(isSelectionRewriteActionKey({ ...baseEvent, shiftKey: true })).toBe(false);
    expect(isSelectionRewriteActionKey({ ...baseEvent, isComposing: true })).toBe(false);
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
    status: "editing-prompt",
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
    codexPath: "/usr/local/bin/codex",
    cwd: "/vault",
    editor: editorFixture().editor,
    runtimeSettings: { rewriteSelectionModel: null, rewriteSelectionEffort: null },
    sendShortcut: "enter",
    state: rewriteState(),
    ...overrides,
  };
}

function editorFixture(options: { currentText?: string } = {}): {
  editor: ConstructorParameters<typeof SelectionRewritePopover>[0]["editor"];
  getRange: ReturnType<typeof vi.fn>;
  replaceRange: ReturnType<typeof vi.fn>;
} {
  const getRange = vi.fn(() => options.currentText ?? "Revise this sentence.");
  const replaceRange = vi.fn();
  return {
    editor: {
      getCursor: () => ({ line: 1, ch: 22 }),
      getRange,
      posToOffset: () => 0,
      replaceRange,
    } as unknown as ConstructorParameters<typeof SelectionRewritePopover>[0]["editor"],
    getRange,
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

function runOptions(clientFactory: SelectionRewriteClientFactory): Parameters<typeof runSelectionRewrite>[0] {
  return {
    codexPath: "/bin/codex",
    cwd: "/vault",
    prompt: "Rewrite this.",
    clientFactory,
  };
}

function fakeSelectionRewriteClientFactory(configure?: (client: FakeSelectionRewriteClient) => void): {
  clientFactory: SelectionRewriteClientFactory;
  client: { current: FakeSelectionRewriteClient | null };
} {
  const client: { current: FakeSelectionRewriteClient | null } = { current: null };
  return {
    client,
    clientFactory: (_codexPath, _cwd, handlers) => {
      client.current = new FakeSelectionRewriteClient(handlers);
      configure?.(client.current);
      return client.current;
    },
  };
}

class FakeSelectionRewriteClient implements SelectionRewriteClient {
  disconnected = false;
  startStructuredTurnImpl: (() => Promise<TurnStartResponse>) | null = null;
  readonly structuredTurnStarted: Promise<void>;
  private resolveStructuredTurnStarted!: () => void;

  constructor(private readonly handlers: AppServerClientHandlers) {
    this.structuredTurnStarted = new Promise((resolve) => {
      this.resolveStructuredTurnStarted = resolve;
    });
  }

  async connect(): Promise<InitializeResponse> {
    return { codexHome: "/tmp/codex" } as InitializeResponse;
  }

  disconnect(): void {
    this.disconnected = true;
  }

  async listModels(): Promise<ModelListResponse> {
    return { data: [], nextCursor: null };
  }

  rejectServerRequest(_requestId: RequestId, _code: number, _message: string): void {
    return undefined;
  }

  async startEphemeralThread(): Promise<ThreadStartResponse> {
    return threadStartResponse("thread");
  }

  async startStructuredTurn(_options: AppServerStartStructuredTurnOptions): Promise<TurnStartResponse> {
    this.resolveStructuredTurnStarted();
    return this.startStructuredTurnImpl ? this.startStructuredTurnImpl() : { turn: turn([], { id: "turn", status: "inProgress" }) };
  }

  emit(notification: ServerNotification): void {
    this.handlers.onNotification(notification);
  }
}

function threadStartResponse(threadId: string): ThreadStartResponse {
  return {
    thread: thread(threadId),
    model: "gpt-5.1",
    modelProvider: "openai",
    serviceTier: null,
    cwd: "/vault",
    runtimeWorkspaceRoots: [],
    instructionSources: [],
    approvalPolicy: "never",
    approvalsReviewer: "auto_review",
    sandbox: { type: "readOnly", networkAccess: false },
    activePermissionProfile: null,
    reasoningEffort: null,
  };
}

function thread(id: string): ThreadStartResponse["thread"] {
  return {
    id,
    sessionId: "session",
    forkedFromId: null,
    parentThreadId: null,
    preview: "",
    ephemeral: true,
    modelProvider: "openai",
    createdAt: 1,
    updatedAt: 1,
    status: { type: "idle" },
    path: null,
    cwd: "/vault",
    cliVersion: "0.0.0",
    source: "unknown",
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns: [],
  };
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

function agentMessage(id: string, text: string): TurnItem {
  return { type: "agentMessage", id, text, phase: "final_answer", memoryCitation: null };
}

function agentDeltaNotification(threadId: string, turnId: string, delta: string): ServerNotification {
  return {
    method: "item/agentMessage/delta",
    params: { threadId, turnId, itemId: "agent", delta },
  };
}

function completedItemNotification(threadId: string, turnId: string, item: TurnItem): ServerNotification {
  return {
    method: "item/completed",
    params: { threadId, turnId, item, completedAtMs: 1 },
  };
}

function turnCompletedNotification(threadId: string, completedTurn: Turn): ServerNotification {
  return {
    method: "turn/completed",
    params: { threadId, turn: completedTurn },
  };
}

function modelMetadata(name: string, efforts: ReasoningEffort[]): ModelMetadata {
  return {
    id: name,
    model: name,
    displayName: name,
    description: "",
    hidden: false,
    supportedReasoningEfforts: efforts,
    defaultReasoningEffort: efforts[0] ?? "low",
    inputModalities: ["text"],
    additionalSpeedTiers: [],
    serviceTiers: [],
    defaultServiceTier: null,
    isDefault: false,
  };
}
