// @vitest-environment jsdom

import type { WorkspaceLeaf } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

import { isPersistedTurnDiffViewState, persistedTurnDiffViewState } from "../../../src/features/turn-diff/model";
import { renderTurnDiffView } from "../../../src/features/turn-diff/render.dom";
import { CodexTurnDiffView } from "../../../src/features/turn-diff/view.obsidian";
import { installObsidianDomShims } from "../../support/dom";

installObsidianDomShims();

describe("turn diff view decisions", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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
    const changedFilesSummary = parent.querySelector<HTMLElement>(".codex-panel-turn-diff__files summary");
    expect(changedFilesSummary?.textContent).toBe("Changed files");
    expect(changedFilesSummary?.tabIndex).toBe(-1);
    expect(parent.querySelector(".codex-panel-turn-diff__files")?.textContent).toContain("src/main.ts");
    expect(parent.querySelector(".codex-panel-diff__line--file")?.textContent).toBe("src/main.ts");
    expect(parent.textContent).not.toContain("diff --git");
    expect(parent.textContent).not.toContain("+++ b/src/main.ts");
    expect(parent.textContent).not.toContain("-old");
    expect(parent.textContent).not.toContain("+new");
    expect(parent.textContent).toContain("old");
    expect(parent.textContent).toContain("new");
    expect(parent.querySelectorAll(".codex-panel-diff__line--hunk")).toHaveLength(1);
    expect(parent.querySelectorAll(".codex-panel-diff__line--removed")).toHaveLength(1);
    expect(parent.querySelectorAll(".codex-panel-diff__line--added")).toHaveLength(1);
    parent.querySelector<HTMLButtonElement>(".codex-panel-turn-diff__copy")?.click();
    expect(copyDiff).toHaveBeenCalled();
  });

  it("highlights changed English words inside adjacent removed and added lines", () => {
    const parent = document.createElement("div");

    renderTurnDiffView(parent, {
      threadId: "thread",
      turnId: "turn",
      cwd: "/vault/project",
      files: ["Note.md"],
      diff: "diff --git a/Note.md b/Note.md\n@@\n-The quick brown fox\n+The quick red fox",
    });

    expect(parent.textContent).toContain("The quick brown fox");
    expect(parent.textContent).toContain("The quick red fox");
    expect(parent.querySelector(".codex-panel-diff__word--removed")?.textContent).toBe("brown");
    expect(parent.querySelector(".codex-panel-diff__word--added")?.textContent).toBe("red");
  });

  it("highlights changed Japanese words with Intl.Segmenter", () => {
    const parent = document.createElement("div");

    renderTurnDiffView(parent, {
      threadId: "thread",
      turnId: "turn",
      cwd: "/vault/project",
      files: ["Note.md"],
      diff: "diff --git a/Note.md b/Note.md\n@@\n-吾輩は猫である\n+吾輩は犬である",
    });

    expect(parent.textContent).toContain("吾輩は猫である");
    expect(parent.textContent).toContain("吾輩は犬である");
    expect(parent.querySelector(".codex-panel-diff__word--removed")?.textContent).toBe("猫");
    expect(parent.querySelector(".codex-panel-diff__word--added")?.textContent).toBe("犬");
  });

  it("pairs changed words by line inside multi-line replacement blocks", () => {
    const parent = document.createElement("div");

    renderTurnDiffView(parent, {
      threadId: "thread",
      turnId: "turn",
      cwd: "/vault/project",
      files: ["Note.md"],
      diff: [
        "diff --git a/Note.md b/Note.md",
        "@@",
        "-これはdiffのテストです。",
        "-今日は元気です。",
        "-とても元気です。",
        "+これはdiffのてすとです。",
        "+きょうはげんきです。",
        "+とてもげんきです。",
      ].join("\n"),
    });

    const removedHighlights = Array.from(parent.querySelectorAll(".codex-panel-diff__word--removed"), (element) => element.textContent);
    const addedHighlights = Array.from(parent.querySelectorAll(".codex-panel-diff__word--added"), (element) => element.textContent);

    expect(removedHighlights).toEqual(["テスト", "今日", "元気", "元気"]);
    expect(addedHighlights).toEqual(["てすと", "きょう", "げんき", "げんき"]);
    expect(removedHighlights).not.toContain("これはdiffのテスト");
  });

  it("falls back to line-level rendering for large intraline candidates", () => {
    const parent = document.createElement("div");
    const oldText = `start ${"old ".repeat(600)}end`;
    const newText = `start ${"new ".repeat(600)}end`;

    renderTurnDiffView(parent, {
      threadId: "thread",
      turnId: "turn",
      cwd: "/vault/project",
      files: ["Note.md"],
      diff: `diff --git a/Note.md b/Note.md\n@@\n-${oldText}\n+${newText}`,
    });

    expect(parent.textContent).toContain(oldText);
    expect(parent.textContent).toContain(newText);
    expect(parent.querySelector(".codex-panel-diff__word")).toBeNull();
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

  it.each([
    {
      name: "a complete state with a vault path",
      value: { threadId: "thread", turnId: "turn", cwd: "/vault/project", files: ["src/main.ts"] },
      valid: true,
    },
    {
      name: "a complete state without a working directory",
      value: { threadId: "thread", turnId: "turn", cwd: null, files: [] },
      valid: true,
    },
    { name: "null", value: null, valid: false },
    {
      name: "a missing turn id",
      value: { threadId: "thread", cwd: "/vault/project", files: ["src/main.ts"] },
      valid: false,
    },
    {
      name: "a non-array file list",
      value: { threadId: "thread", turnId: "turn", cwd: "/vault/project", files: "src/main.ts" },
      valid: false,
    },
    {
      name: "a file list containing a non-string value",
      value: { threadId: "thread", turnId: "turn", cwd: "/vault/project", files: ["src/main.ts", 42] },
      valid: false,
    },
    {
      name: "an undefined working directory",
      value: { threadId: "thread", turnId: "turn", files: [] },
      valid: false,
    },
  ])("classifies $name as persisted state: $valid", ({ value, valid }) => {
    expect(isPersistedTurnDiffViewState(value)).toBe(valid);
  });

  it("renders restored turn diff metadata without unavailable diff text", () => {
    const parent = document.createElement("div");

    renderTurnDiffView(parent, null, {}, { threadId: "thread", turnId: "turn", cwd: "/vault/project", files: ["src/main.ts"] });

    expect(parent.querySelector(".codex-panel-turn-diff__meta")?.textContent).toContain("thread / turn");
    expect(parent.textContent).toContain("Turn diff is no longer available.");
    expect(parent.querySelector(".codex-panel-turn-diff__copy")).toBeNull();
    expect(parent.querySelector(".codex-panel-turn-diff__diff")).toBeNull();
  });

  it("restores only persisted metadata and clears an in-memory diff payload", async () => {
    const containerEl = document.createElement("div");
    const view = new CodexTurnDiffView({ containerEl } as unknown as WorkspaceLeaf);
    view.setDiffPayload({
      threadId: "live-thread",
      turnId: "live-turn",
      cwd: "/vault/project",
      files: ["src/live.ts"],
      diff: "@@\n-old\n+new",
    });

    await view.setState(
      {
        threadId: "restored-thread",
        turnId: "restored-turn",
        cwd: null,
        files: ["src/restored.ts"],
      },
      {} as never,
    );

    expect(view.getState()).toEqual({
      threadId: "restored-thread",
      turnId: "restored-turn",
      cwd: null,
      files: ["src/restored.ts"],
    });
    expect(view.contentEl.textContent).toContain("Turn diff is no longer available.");
    expect(view.contentEl.textContent).not.toContain("old");
    expect(view.contentEl.querySelector(".codex-panel-turn-diff__copy")).toBeNull();
  });

  it("rejects invalid restored metadata instead of showing a partial turn identity", async () => {
    const containerEl = document.createElement("div");
    const view = new CodexTurnDiffView({ containerEl } as unknown as WorkspaceLeaf);

    await view.setState(
      {
        threadId: "thread",
        turnId: "turn",
        cwd: "/vault/project",
        files: ["src/main.ts", 42],
      },
      {} as never,
    );

    expect(view.getState()).toEqual({});
    expect(view.contentEl.textContent).toBe("No turn diff selected.");
  });

  it("copies the current in-memory diff from the view action", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText },
    });
    const containerEl = document.createElement("div");
    const view = new CodexTurnDiffView({ containerEl } as unknown as WorkspaceLeaf);
    view.setDiffPayload({
      threadId: "thread",
      turnId: "turn",
      cwd: "/vault/project",
      files: ["src/main.ts"],
      diff: "@@\n-old\n+new",
    });

    view.contentEl.querySelector<HTMLButtonElement>(".codex-panel-turn-diff__copy")?.click();

    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("@@\n-old\n+new");
    });
  });

  it("unmounts the turn diff Preact root when the view closes", async () => {
    const containerEl = document.createElement("div");
    const view = new CodexTurnDiffView({ containerEl } as unknown as WorkspaceLeaf);

    view.setDiffPayload({
      threadId: "thread",
      turnId: "turn",
      cwd: "/vault/project",
      files: ["src/main.ts"],
      diff: "diff --git a/src/main.ts b/src/main.ts\n@@\n-old\n+new",
    });

    expect(view.contentEl.querySelector(".codex-panel-turn-diff__title")?.textContent).toBe("Turn diff");

    await view.onClose();

    expect(view.contentEl.childElementCount).toBe(0);
  });
});
