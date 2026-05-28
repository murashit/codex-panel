// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import type { WorkspaceLeaf } from "obsidian";

import {
  renderComposerShell,
  renderComposerSuggestions,
  scrollComposerSuggestionIntoView,
  syncComposerHeight,
} from "../../../../src/features/chat/ui/composer";
import { renderToolbar, type ToolbarViewModel } from "../../../../src/features/chat/ui/toolbar";
import { CodexChatTurnDiffView } from "../../../../src/features/chat/chat-turn-diff-view";
import { displayDiffLines, persistedChatTurnDiffViewState, renderChatTurnDiffView } from "../../../../src/features/chat/ui/turn-diff";
import { changeInputValue, composerSuggestionScrollFixture, installObsidianDomShims } from "./dom-test-helpers";
import { renderThreadsView } from "../../../../src/features/threads-view/renderer";
import { liveStateForSnapshots, threadRows, type ThreadsRowModel } from "../../../../src/features/threads-view/state";
import type { Thread } from "../../../../src/generated/app-server/v2/Thread";
import type { OpenCodexPanelSnapshot } from "../../../../src/runtime/open-panel-snapshot";

installObsidianDomShims();

function expectPresent<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected value to be present");
  return value;
}

function composerCallbacks() {
  return {
    onInput: vi.fn(),
    onComposerResize: vi.fn(),
    onUpdateSuggestions: vi.fn(),
    onKeydown: vi.fn(),
    onNewThread: vi.fn(),
    onSendOrInterrupt: vi.fn(),
    onSuggestionHover: vi.fn(),
    onSuggestionInsert: vi.fn(),
  };
}

function openPanelSnapshot(
  overrides: Partial<{
    viewId: string;
    threadId: string | null;
    turnLifecycle: OpenCodexPanelSnapshot["turnLifecycle"];
    pendingApprovals: number;
    pendingUserInputs: number;
    hasComposerDraft: boolean;
    connected: boolean;
  }> = {},
): OpenCodexPanelSnapshot {
  return {
    viewId: "view",
    threadId: "thread",
    turnLifecycle: { kind: "idle" },
    pendingApprovals: 0,
    pendingUserInputs: 0,
    hasComposerDraft: false,
    connected: true,
    ...overrides,
  };
}

function threadFixture(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "thread",
    sessionId: "session",
    forkedFromId: null,
    preview: "",
    ephemeral: false,
    modelProvider: "openai",
    createdAt: 1,
    updatedAt: 1,
    status: { type: "idle" },
    path: null,
    cwd: "/vault",
    cliVersion: "0.0.0",
    source: "appServer",
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns: [],
    ...overrides,
  };
}

function threadsViewActions() {
  return {
    refresh: vi.fn(),
    openNewPanel: vi.fn(),
    openThread: vi.fn(),
    startRename: vi.fn(),
    updateRename: vi.fn(),
    saveRename: vi.fn(),
    cancelRename: vi.fn(),
    autoNameThread: vi.fn(),
    startArchive: vi.fn(),
    archiveThread: vi.fn(),
  };
}

describe("chat turn diff view decisions", () => {
  it("renders the turn diff view with classified unified diff lines", () => {
    const parent = document.createElement("div");
    const copyDiff = vi.fn();

    renderChatTurnDiffView(
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

    expect(parent.querySelector(".codex-panel-chat-turn-diff__title")?.textContent).toBe("Turn diff");
    expect(parent.querySelector(".codex-panel-chat-turn-diff__meta")?.textContent).toContain("019e061e");
    expect(parent.querySelector(".codex-panel-chat-turn-diff__files summary")?.textContent).toBe("Changed files");
    expect(parent.querySelector(".codex-panel-chat-turn-diff__files")?.textContent).toContain("src/main.ts");
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
    parent.querySelector<HTMLButtonElement>(".codex-panel-chat-turn-diff__copy")?.click();
    expect(copyDiff).toHaveBeenCalled();
  });

  it("highlights changed English words inside adjacent removed and added lines", () => {
    const parent = document.createElement("div");

    renderChatTurnDiffView(parent, {
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

    renderChatTurnDiffView(parent, {
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

    renderChatTurnDiffView(parent, {
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

    renderChatTurnDiffView(parent, {
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
    const persisted = persistedChatTurnDiffViewState({
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

    renderChatTurnDiffView(parent, null, {}, { threadId: "thread", turnId: "turn", cwd: "/vault/project", files: ["src/main.ts"] });

    expect(parent.querySelector(".codex-panel-chat-turn-diff__meta")?.textContent).toContain("thread / turn");
    expect(parent.textContent).toContain("Turn diff is no longer available.");
    expect(parent.querySelector(".codex-panel-chat-turn-diff__copy")).toBeNull();
    expect(parent.querySelector(".codex-panel-chat-turn-diff__diff")).toBeNull();
  });

  it("unmounts the turn diff React root when the view closes", async () => {
    const containerEl = document.createElement("div");
    const view = new CodexChatTurnDiffView({ containerEl } as unknown as WorkspaceLeaf);

    view.setDiffPayload({
      threadId: "thread",
      turnId: "turn",
      cwd: "/vault/project",
      files: ["src/main.ts"],
      diff: "diff --git a/src/main.ts b/src/main.ts\n@@\n-old\n+new",
    });

    expect(view.contentEl.querySelector(".codex-panel-chat-turn-diff__title")?.textContent).toBe("Turn diff");

    await view.onClose();

    expect(view.contentEl.childElementCount).toBe(0);
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
});

describe("toolbar renderer decisions", () => {
  it("renders toolbar controls as buttons and updates live status state", () => {
    const parent = document.createElement("div");
    const toggleHistory = vi.fn();
    const toggleAutoReview = vi.fn();
    const baseModel = toolbarModel();

    renderToolbar(parent, baseModel, toolbarActions({ toggleHistory, toggleAutoReview }));

    const statusButton = parent.querySelector(".codex-panel__status-dot");
    expect(statusButton?.tagName).toBe("BUTTON");
    expect(statusButton?.getAttribute("role")).toBeNull();
    expect(statusButton?.getAttribute("aria-label")).toBe("Show connection status");
    expect(statusButton?.classList.contains("nav-action-button")).toBe(false);
    expect(statusButton?.classList.contains("clickable-icon")).toBe(true);
    const historyButton = parent.querySelector<HTMLButtonElement>(".codex-panel__history-toggle");
    expect(historyButton?.getAttribute("aria-label")).toBe("Show thread list");
    expect(historyButton?.classList.contains("nav-action-button")).toBe(false);
    expect(historyButton?.classList.contains("clickable-icon")).toBe(true);
    historyButton?.click();
    expect(toggleHistory).toHaveBeenCalled();
    const autoReviewButton = parent.querySelector<HTMLButtonElement>(".codex-panel__auto-review-toggle");
    expect(autoReviewButton?.getAttribute("aria-label")).toBe("Toggle auto-review");
    expect(autoReviewButton?.getAttribute("aria-pressed")).toBe("false");
    expect(autoReviewButton?.classList.contains("nav-action-button")).toBe(false);
    expect(autoReviewButton?.classList.contains("clickable-icon")).toBe(true);
    autoReviewButton?.click();
    expect(toggleAutoReview).toHaveBeenCalled();

    parent.empty();
    renderToolbar(parent, toolbarModel({ status: "Turn running...", statusState: "running", autoReviewActive: true }), toolbarActions());
    expect(parent.querySelector(".codex-panel__status-dot")?.getAttribute("aria-label")).toBe("Show connection status");
    expect(parent.querySelector(".codex-panel__auto-review-toggle")?.getAttribute("aria-pressed")).toBe("true");

    parent.empty();
    renderToolbar(parent, toolbarModel({ historyOpen: true, statusPanelOpen: true }), toolbarActions());
    expect(parent.querySelector(".codex-panel__history-toggle")?.getAttribute("aria-label")).toBe("Hide thread list");
    expect(parent.querySelector(".codex-panel__history-toggle")?.classList.contains("is-active")).toBe(false);
    expect(parent.querySelector(".codex-panel__status-dot")?.getAttribute("aria-label")).toBe("Hide connection status");
    expect(parent.querySelector(".codex-panel__runtime-model")?.getAttribute("aria-label")).toBe("Change model and reasoning effort");
  });

  it("keeps frequently changed effort choices first inside the runtime menu", () => {
    const parent = document.createElement("div");

    renderToolbar(
      parent,
      toolbarModel({
        modelChoices: [{ label: "gpt-5.5", selected: true, onClick: vi.fn() }],
        effortChoices: [{ label: "high", selected: true, onClick: vi.fn() }],
      }),
      toolbarActions(),
    );

    expect([...parent.querySelectorAll(".codex-panel__runtime-picker-label")].map((label) => label.textContent)).toEqual([
      "Reasoning effort",
      "Model",
    ]);
    expect([...parent.querySelectorAll(".codex-panel__runtime-choice")].map((choice) => choice.textContent)).toEqual(["high", "gpt-5.5"]);
    for (const choice of parent.querySelectorAll(".codex-panel__runtime-choice")) {
      expect(choice.getAttribute("role")).toBe("option");
      expect(choice.getAttribute("aria-selected")).toBe("true");
      expect(choice.querySelector<HTMLElement>(".codex-panel__toolbar-panel-check")?.dataset["icon"]).toBe("check");
      expect(choice.classList.contains("selected")).toBe(false);
      expect(choice.classList.contains("is-selected")).toBe(false);
    }
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
    const refreshDiagnostics = vi.fn();

    renderToolbar(
      parent,
      toolbarModel({
        statusPanelOpen: true,
        openPanel: "status",
        diagnostics: [
          { title: "Process", rows: [{ label: "Codex App Server", value: "codex-cli/1.2.3" }] },
          { title: "Capabilities", rows: [{ label: "compatibility", value: "model/list failed", level: "error" }] },
        ],
      }),
      toolbarActions({ refreshDiagnostics }),
    );

    expect(parent.querySelector(".codex-panel__connection-diagnostics-title")?.textContent).toBe("Connection");
    expect(parent.textContent).toContain("Process");
    expect(parent.textContent).toContain("Capabilities");
    expect(parent.textContent).toContain("Effective Codex config");
    expect(parent.textContent).toContain("Refresh diagnostics");
    expect(parent.textContent).toContain("codex-cli/1.2.3");
    expect(parent.querySelector(".codex-panel__connection-diagnostics-row--error")?.textContent).toContain("model/list failed");
    const statusItems = [...parent.querySelectorAll<HTMLElement>(".codex-panel__status-panel-item")];
    expect(statusItems.map((item) => item.getAttribute("role"))).toEqual(["menuitem", "menuitem", "menuitem"]);
    expect(statusItems.every((item) => item.getAttribute("aria-selected") === null)).toBe(true);
    statusItems.find((item) => item.textContent.includes("Refresh diagnostics"))?.click();
    expect(refreshDiagnostics).toHaveBeenCalled();
  });

  it("renders diagnostic alert badges on the status dot", () => {
    const normal = document.createElement("div");
    renderToolbar(normal, toolbarModel({ diagnosticAlertLevel: "normal" }), toolbarActions());
    const normalStatus = normal.querySelector(".codex-panel__status-dot");
    expect(normalStatus?.querySelector(".codex-panel__status-dot-diagnostic")).toBeNull();
    expect(normalStatus?.getAttribute("aria-label")).toBe("Show connection status");

    const warning = document.createElement("div");
    renderToolbar(warning, toolbarModel({ diagnosticAlertLevel: "warning" }), toolbarActions());
    const warningStatus = warning.querySelector(".codex-panel__status-dot");
    expect(warningStatus?.classList.contains("codex-panel__status-dot--diagnostic-warning")).toBe(true);
    expect(warningStatus?.querySelector(".codex-panel__status-dot-diagnostic--warning")).not.toBeNull();
    expect(warningStatus?.getAttribute("aria-label")).toBe("Show connection status");

    const error = document.createElement("div");
    renderToolbar(error, toolbarModel({ diagnosticAlertLevel: "error" }), toolbarActions());
    const errorStatus = error.querySelector(".codex-panel__status-dot");
    expect(errorStatus?.classList.contains("codex-panel__status-dot--diagnostic-error")).toBe(true);
    expect(errorStatus?.querySelector(".codex-panel__status-dot-diagnostic--error")).not.toBeNull();
    expect(errorStatus?.getAttribute("aria-label")).toBe("Show connection status");
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

  it("renders thread list rename actions and an inline rename editor", () => {
    const parent = document.createElement("div");
    const startRenameThread = vi.fn();
    const updateRenameDraft = vi.fn();
    const saveRenameThread = vi.fn();
    const cancelRenameThread = vi.fn();
    const autoNameThread = vi.fn();
    const actions = toolbarActions({ startRenameThread, updateRenameDraft, saveRenameThread, cancelRenameThread, autoNameThread });

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
      actions,
    );

    parent.querySelector<HTMLButtonElement>('[aria-label="Rename thread"]')?.click();
    expect(startRenameThread).toHaveBeenCalledWith("thread");

    const input = parent.querySelector<HTMLInputElement>(".codex-panel__thread-rename-input");
    if (!input) throw new Error("Missing thread rename input");
    expect(input.closest(".codex-panel__thread-rename")?.querySelector(".codex-panel__toolbar-panel-check")).not.toBeNull();
    expect(input.value).toBe("Draft title");
    changeInputValue(input, "New title");
    expect(updateRenameDraft).toHaveBeenCalledWith("editing", "New title");

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
            rename: { draft: "New title", generating: false },
          },
        ],
      }),
      actions,
    );
    expectPresent(parent.querySelector<HTMLInputElement>(".codex-panel__thread-rename-input")).dispatchEvent(
      new FocusEvent("focusout", { bubbles: true }),
    );
    expect(saveRenameThread).toHaveBeenCalledWith("editing", "New title");
    expectPresent(parent.querySelector<HTMLInputElement>(".codex-panel__thread-rename-input")).dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(cancelRenameThread).toHaveBeenCalledWith("editing");
    expect(parent.querySelector<HTMLButtonElement>('[aria-label="Save thread name"]')).toBeNull();
    expect(parent.querySelector<HTMLButtonElement>('[aria-label="Cancel rename"]')).toBeNull();
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
    expect(parent.querySelector<HTMLButtonElement>('[aria-label="Save thread name"]')).toBeNull();
    expect(parent.querySelector<HTMLButtonElement>('[aria-label="Auto-name thread"]')?.disabled).toBe(true);
    expect(parent.querySelector<HTMLButtonElement>('[aria-label="Cancel rename"]')).toBeNull();
  });

  it("renders toolbar archive confirmation with the default action on the right", () => {
    const parent = document.createElement("div");
    const startArchiveThread = vi.fn();
    const archiveThread = vi.fn();

    renderToolbar(
      parent,
      toolbarModel({
        historyOpen: true,
        openPanel: "history",
        threads: [
          {
            title: "Thread",
            threadId: "thread",
            selected: true,
            disabled: false,
            canArchive: true,
            archiveConfirm: { active: true, defaultSaveMarkdown: true },
            rename: null,
          },
        ],
      }),
      toolbarActions({ startArchiveThread, archiveThread }),
    );

    const confirm = expectPresent(parent.querySelector<HTMLElement>(".codex-panel__archive-confirm"));
    const archiveButtons = [
      ...confirm.querySelectorAll<HTMLButtonElement>(".codex-panel__archive-alternate, .codex-panel__archive-default"),
    ];
    expect(archiveButtons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Archive thread without saving",
      "Save and archive thread",
    ]);
    expect(parent.querySelector<HTMLButtonElement>('[aria-label="Rename thread"]')).toBeNull();
    archiveButtons[0]?.click();
    expect(archiveThread).toHaveBeenCalledWith("thread", false);
    archiveButtons[1]?.click();
    expect(archiveThread).toHaveBeenCalledWith("thread", true);
    expect(startArchiveThread).not.toHaveBeenCalled();
  });
});

describe("threads view renderer decisions", () => {
  it("prioritizes open panel live state per thread", () => {
    expect(
      liveStateForSnapshots([
        openPanelSnapshot({ viewId: "open", threadId: "thread" }),
        openPanelSnapshot({ viewId: "running", threadId: "thread", turnLifecycle: { kind: "running", turnId: "turn" } }),
        openPanelSnapshot({ viewId: "approval", threadId: "thread", pendingApprovals: 1 }),
        openPanelSnapshot({ viewId: "input", threadId: "thread", pendingUserInputs: 1 }),
      ]),
    ).toMatchObject({ status: "needs-input", label: "Needs input", viewId: "input", openPanels: 4 });

    expect(liveStateForSnapshots([openPanelSnapshot({ viewId: "draft", threadId: "thread", hasComposerDraft: true })])).toMatchObject({
      status: "draft",
      label: "Draft",
    });
    expect(liveStateForSnapshots([openPanelSnapshot({ viewId: "offline", threadId: "thread", connected: false })])).toMatchObject({
      status: "offline",
      label: "Offline",
    });
    expect(
      liveStateForSnapshots([openPanelSnapshot({ viewId: "none", threadId: null, turnLifecycle: { kind: "running", turnId: "turn" } })]),
    ).toBeNull();
  });

  it("renders thread rows with live state and routes open actions", () => {
    const parent = document.createElement("div");
    const actions = threadsViewActions();
    const rows = threadRows(
      [threadFixture({ id: "closed", preview: "Closed thread" }), threadFixture({ id: "open", preview: "Open thread", updatedAt: 2 })],
      [openPanelSnapshot({ viewId: "view-open", threadId: "open", pendingApprovals: 1 })],
      new Map(),
    );

    renderThreadsView(parent, { status: "2 threads", loading: false, rows }, actions);

    expect(parent.querySelector(".codex-panel-threads__badge")).toBeNull();
    const row = expectPresent(parent.querySelector<HTMLElement>(".codex-panel-threads__row--approval"));
    expect(row.getAttribute("title")).toBeNull();
    const toolbarButtons = [...parent.querySelectorAll<HTMLButtonElement>(".codex-panel-threads__toolbar-button")];
    expect(toolbarButtons.map((button) => button.getAttribute("aria-label"))).toEqual(["Open new panel", "Refresh threads"]);
    const refresh = expectPresent(parent.querySelector<HTMLButtonElement>('[aria-label="Refresh threads"]'));
    expect(refresh.classList.contains("codex-panel-threads__toolbar-button")).toBe(true);
    refresh.click();
    expect(actions.refresh).toHaveBeenCalledOnce();
    const openNewPanel = expectPresent(parent.querySelector<HTMLButtonElement>('[aria-label="Open new panel"]'));
    expect(openNewPanel.classList.contains("codex-panel-threads__toolbar-button")).toBe(true);
    expect(openNewPanel.classList.contains("codex-panel-threads__row-button")).toBe(false);
    openNewPanel.click();
    expect(actions.openNewPanel).toHaveBeenCalledOnce();
    row.click();
    expect(actions.openThread).toHaveBeenCalledWith("open");
    row.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(actions.openThread).toHaveBeenCalledTimes(2);
    expect(parent.querySelector<HTMLButtonElement>('[aria-label="Focus open panel"]')).toBeNull();
    expect(parent.querySelector<HTMLButtonElement>('[aria-label="Open in new panel"]')).toBeNull();
  });

  it("renders threads view archive confirmation with the default action on the right", () => {
    const parent = document.createElement("div");
    const actions = threadsViewActions();
    const row: ThreadsRowModel = {
      thread: threadFixture({ id: "thread", name: "Thread" }),
      title: "Thread",
      live: null,
      rename: { active: false, draft: "Thread", generating: false },
      archiveConfirm: { active: true, defaultSaveMarkdown: false },
    };

    renderThreadsView(parent, { status: "1 thread", loading: false, rows: [row] }, actions);

    const confirm = expectPresent(parent.querySelector<HTMLElement>(".codex-panel-threads__archive-confirm"));
    const archiveButtons = [
      ...confirm.querySelectorAll<HTMLButtonElement>(".codex-panel-threads__archive-alternate, .codex-panel-threads__archive-default"),
    ];
    expect(archiveButtons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Save and archive thread",
      "Archive thread without saving",
    ]);
    expect(parent.querySelector<HTMLButtonElement>('[aria-label="Rename thread"]')).toBeNull();
    archiveButtons[0]?.click();
    expect(actions.archiveThread).toHaveBeenCalledWith("thread", true);
    archiveButtons[1]?.click();
    expect(actions.archiveThread).toHaveBeenCalledWith("thread", false);
  });

  it("starts threads view archive confirmation before archiving", () => {
    const parent = document.createElement("div");
    const actions = threadsViewActions();
    const row: ThreadsRowModel = {
      thread: threadFixture({ id: "thread", name: "Thread" }),
      title: "Thread",
      live: null,
      rename: { active: false, draft: "Thread", generating: false },
    };

    renderThreadsView(parent, { status: "1 thread", loading: false, rows: [row] }, actions);
    parent.querySelector<HTMLButtonElement>('[aria-label="Archive thread"]')?.click();

    expect(actions.startArchive).toHaveBeenCalledWith("thread");
    expect(actions.archiveThread).not.toHaveBeenCalled();
  });

  it("renders rename rows and saves entered values", () => {
    const parent = document.createElement("div");
    const actions = threadsViewActions();
    const row: ThreadsRowModel = {
      thread: threadFixture({ id: "thread", name: "Old name" }),
      title: "Old name",
      live: null,
      rename: { active: true, draft: "Old name", generating: false },
    };

    renderThreadsView(parent, { status: "1 thread", loading: false, rows: [row] }, actions);

    const input = expectPresent(parent.querySelector<HTMLInputElement>(".codex-panel-threads__rename-input"));
    changeInputValue(input, "New name");
    expect(actions.updateRename).toHaveBeenCalledWith("thread", "New name");

    renderThreadsView(
      parent,
      { status: "1 thread", loading: false, rows: [{ ...row, rename: { active: true, draft: "New name", generating: false } }] },
      actions,
    );
    expectPresent(parent.querySelector<HTMLInputElement>(".codex-panel-threads__rename-input")).dispatchEvent(
      new FocusEvent("focusout", { bubbles: true }),
    );
    expect(actions.saveRename).toHaveBeenCalledWith("thread", "New name");

    expectPresent(parent.querySelector<HTMLElement>(".codex-panel-threads__row")).click();
    expect(actions.openThread).not.toHaveBeenCalled();
  });

  it("renders threads view rename actions inline with auto-name", () => {
    const parent = document.createElement("div");
    const actions = threadsViewActions();
    const row: ThreadsRowModel = {
      thread: threadFixture({ id: "thread", name: "Old name" }),
      title: "Old name",
      live: null,
      rename: { active: true, draft: "Old name", generating: false },
    };

    renderThreadsView(parent, { status: "1 thread", loading: false, rows: [row] }, actions);

    expect(parent.querySelector<HTMLElement>(".codex-panel-threads__rename-form")).toBeTruthy();
    const actionsGroup = expectPresent(parent.querySelector<HTMLElement>(".codex-panel-threads__rename-actions"));
    expect(actionsGroup.querySelectorAll(".codex-panel-threads__row-button")).toHaveLength(1);
    expect(parent.querySelector<HTMLButtonElement>('[aria-label="Save thread name"]')).toBeNull();
    expect(parent.querySelector<HTMLButtonElement>('[aria-label="Cancel rename"]')).toBeNull();
    parent.querySelector<HTMLButtonElement>('[aria-label="Auto-name thread"]')?.click();

    expect(actions.autoNameThread).toHaveBeenCalledWith("thread");
  });

  it("renders threads view rename auto-name loading state", () => {
    const parent = document.createElement("div");
    const row: ThreadsRowModel = {
      thread: threadFixture({ id: "thread", name: "Old name" }),
      title: "Old name",
      live: null,
      rename: { active: true, draft: "Old name", generating: true },
    };

    renderThreadsView(parent, { status: "1 thread", loading: false, rows: [row] }, threadsViewActions());

    expect(parent.querySelector<HTMLInputElement>(".codex-panel-threads__rename-input")?.disabled).toBe(false);
    expect(parent.querySelector<HTMLButtonElement>('[aria-label="Save thread name"]')).toBeNull();
    expect(parent.querySelector<HTMLButtonElement>('[aria-label="Auto-name thread"]')?.disabled).toBe(true);
    expect(parent.querySelector<HTMLButtonElement>('[aria-label="Cancel rename"]')).toBeNull();
  });
});

describe("composer renderer decisions", () => {
  it("uses the provided composer placeholder for normal input", () => {
    const parent = document.createElement("div");
    const callbacks = composerCallbacks();
    const { composer } = renderComposerShell(
      parent,
      "view",
      "",
      false,
      false,
      "Ask Codex to work on “Refactor terminal streaming”...",
      callbacks,
    );

    expect(composer.getAttribute("placeholder")).toBe("Ask Codex to work on “Refactor terminal streaming”...");

    renderComposerShell(parent, "view", "", false, false, "Ask Codex to work on “Renamed thread”...", callbacks);

    expect(composer.getAttribute("placeholder")).toBe("Ask Codex to work on “Renamed thread”...");
  });

  it("renders composer suggestions outside normal input flow callbacks", () => {
    const parent = document.createElement("div");
    const onSuggestionInsert = vi.fn();
    const { composer, suggestions } = renderComposerShell(parent, "view", "", false, false, "Ask Codex to work on this task...", {
      onInput: vi.fn(),
      onComposerResize: vi.fn(),
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

  it("reports composer draft changes from the controlled input", () => {
    const parent = document.createElement("div");
    const callbacks = composerCallbacks();
    const { composer } = renderComposerShell(parent, "view", "", false, false, "Ask Codex to work on this task...", callbacks);

    changeInputValue(composer, "Draft text");

    expect(callbacks.onInput).toHaveBeenCalledWith("Draft text");
  });

  it("reports composer resize when autogrow changes the input height", () => {
    const parent = document.createElement("div");
    const callbacks = composerCallbacks();
    let scrollHeight = 56;
    const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "scrollHeight");
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
      get: () => scrollHeight,
      configurable: true,
    });
    try {
      const { composer } = renderComposerShell(parent, "view", "", false, false, "Ask Codex to work on this task...", callbacks);
      callbacks.onComposerResize.mockClear();

      scrollHeight = 120;
      changeInputValue(composer, "line one\nline two");

      expect(callbacks.onComposerResize).toHaveBeenCalledOnce();
    } finally {
      if (descriptor) {
        Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", descriptor);
      } else {
        Reflect.deleteProperty(HTMLTextAreaElement.prototype, "scrollHeight");
      }
    }
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
    const callbacks = composerCallbacks();
    const { composer } = renderComposerShell(parent, "view", "", true, true, "Ask Codex to work on this task...", callbacks);
    let sendButton = parent.querySelector<HTMLButtonElement>(".codex-panel__send");

    expect(sendButton?.getAttribute("aria-label")).toBe("Interrupt");
    expect(composer.getAttribute("placeholder")).toBe("Add steering message...");
    expect(sendButton?.classList.contains("is-interrupt")).toBe(true);
    expect(sendButton?.classList.contains("is-steer")).toBe(false);
    expect(sendButton?.dataset["icon"]).toBe("square");

    renderComposerShell(parent, "view", "adjust course", true, true, "Ask Codex to work on this task...", callbacks);
    sendButton = parent.querySelector<HTMLButtonElement>(".codex-panel__send");
    expect(sendButton?.getAttribute("aria-label")).toBe("Steer");
    expect(composer.getAttribute("placeholder")).toBe("Add steering message...");
    expect(sendButton?.classList.contains("is-interrupt")).toBe(false);
    expect(sendButton?.classList.contains("is-steer")).toBe(true);
    expect(sendButton?.dataset["icon"]).toBe("corner-down-right");
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
    autoReviewActive: false,
    fastActive: false,
    runtimeSummary: "5.5 high",
    runtimeTitle: "Model: gpt-5.5; Effort: high",
    runtimeEmphasized: false,
    context: null,
    rateLimit: null,
    configSections: [],
    openPanel: "runtime",
    threads: [{ title: "Thread", threadId: "thread", selected: true, disabled: false, canArchive: true, rename: null }],
    modelChoices: [{ label: "Default", selected: true, onClick: vi.fn() }],
    effortChoices: [{ label: "Default", selected: true, onClick: vi.fn() }],
    connectLabel: "Reconnect",
    diagnostics: [{ title: "Process", rows: [{ label: "Codex App Server", value: "codex-cli/test" }] }],
    diagnosticAlertLevel: "normal",
    ...overrides,
  };
}

function toolbarActions(overrides: Partial<Parameters<typeof renderToolbar>[2]> = {}): Parameters<typeof renderToolbar>[2] {
  return {
    toggleHistory: vi.fn(),
    toggleAutoReview: vi.fn(),
    toggleStatusPanel: vi.fn(),
    togglePlan: vi.fn(),
    toggleFast: vi.fn(),
    toggleRuntime: vi.fn(),
    connect: vi.fn(),
    refreshDiagnostics: vi.fn(),
    refreshThreads: vi.fn(),
    resumeThread: vi.fn(),
    startArchiveThread: vi.fn(),
    archiveThread: vi.fn(),
    startRenameThread: vi.fn(),
    updateRenameDraft: vi.fn(),
    saveRenameThread: vi.fn(),
    cancelRenameThread: vi.fn(),
    autoNameThread: vi.fn(),
    ...overrides,
  };
}
