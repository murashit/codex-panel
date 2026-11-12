// @vitest-environment jsdom

import type { WorkspaceLeaf } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

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

  it("does not persist the session-only diff payload in view state", () => {
    const view = diffView();
    view.setDiffPayload(diffPayload());

    expect(view.getState()).toEqual({});
    expect(view.contentEl.textContent).toContain("old");
  });

  it("copies the current in-memory diff from the view action", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText },
    });
    const view = diffView();
    view.setDiffPayload(diffPayload());

    view.contentEl.querySelector<HTMLButtonElement>(".codex-panel-turn-diff__copy")?.click();

    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("@@\n-old\n+new");
    });
  });

  it("unmounts the turn diff Preact root when the view closes", async () => {
    const view = diffView();

    view.setDiffPayload({
      threadId: "thread",
      turnId: "turn",
      files: ["src/main.ts"],
      diff: "diff --git a/src/main.ts b/src/main.ts\n@@\n-old\n+new",
    });

    expect(view.contentEl.querySelector(".codex-panel-turn-diff__title")?.textContent).toBe("Turn diff");

    await view.onClose();

    expect(view.contentEl.childElementCount).toBe(0);
  });
});

function diffView() {
  return new CodexTurnDiffView({ containerEl: document.createElement("div") } as unknown as WorkspaceLeaf);
}

function diffPayload() {
  return {
    threadId: "thread",
    turnId: "turn",
    files: ["src/main.ts"],
    diff: "@@\n-old\n+new",
  };
}
