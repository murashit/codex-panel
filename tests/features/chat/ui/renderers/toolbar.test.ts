// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import type { ToolbarViewModel } from "../../../../../src/features/chat/toolbar-model";
import { renderToolbar } from "../../../../../src/features/chat/ui/toolbar";
import { changeInputValue, installObsidianDomShims } from "../../../../support/dom";

installObsidianDomShims();

function expectPresent<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected value to be present");
  return value;
}

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
    const planButton = parent.querySelector<HTMLButtonElement>(".codex-panel__plan-toggle");
    expect(planButton?.getAttribute("aria-label")).toBe("Toggle plan mode");
    expect(planButton?.getAttribute("aria-pressed")).toBe("false");
    expect(planButton?.classList.contains("codex-panel__runtime-icon")).toBe(true);
    const autoReviewButton = parent.querySelector<HTMLButtonElement>(".codex-panel__auto-review-toggle");
    expect(autoReviewButton?.getAttribute("aria-label")).toBe("Toggle auto-review");
    expect(autoReviewButton?.getAttribute("aria-pressed")).toBe("false");
    expect(autoReviewButton?.classList.contains("codex-panel__runtime-icon")).toBe(true);
    expect(autoReviewButton?.classList.contains("nav-action-button")).toBe(false);
    expect(autoReviewButton?.classList.contains("clickable-icon")).toBe(true);
    autoReviewButton?.click();
    expect(toggleAutoReview).toHaveBeenCalled();
    expect([...parent.querySelectorAll(".codex-panel__runtime-strip > button")].map((button) => button.getAttribute("aria-label"))).toEqual(
      ["Toggle plan mode", "Toggle auto-review", "Toggle fast mode", "Change model and reasoning effort"],
    );

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
    const refreshStatus = vi.fn();

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
      toolbarActions({ refreshStatus }),
    );

    expect(parent.querySelector(".codex-panel__connection-diagnostics-title")?.textContent).toBe("Connection");
    expect(parent.textContent).toContain("Process");
    expect(parent.textContent).toContain("Capabilities");
    expect(parent.textContent).toContain("Effective Codex config");
    expect(parent.textContent).toContain("Refresh status");
    expect(parent.textContent).not.toContain("Refresh diagnostics");
    expect(parent.textContent).not.toContain("Refresh thread list");
    expect(parent.textContent).toContain("codex-cli/1.2.3");
    expect(parent.querySelector(".codex-panel__connection-diagnostics-row--error")?.textContent).toContain("model/list failed");
    const statusItems = [...parent.querySelectorAll<HTMLElement>(".codex-panel__status-panel-item")];
    expect(statusItems.map((item) => item.getAttribute("role"))).toEqual(["menuitem", "menuitem"]);
    expect(statusItems.every((item) => item.getAttribute("aria-selected") === null)).toBe(true);
    statusItems.find((item) => item.textContent.includes("Refresh status"))?.click();
    expect(refreshStatus).toHaveBeenCalled();
  });

  it("renders status dot states without diagnostic overlay badges", () => {
    for (const statusState of ["ready", "degraded", "blocked", "running", "offline"] as const) {
      const parent = document.createElement("div");
      renderToolbar(parent, toolbarModel({ statusState }), toolbarActions());
      const status = parent.querySelector(".codex-panel__status-dot");
      expect(status?.classList.contains(`codex-panel__status-dot--${statusState}`)).toBe(true);
      expect(status?.childElementCount).toBe(0);
      expect(status?.getAttribute("aria-label")).toBe("Show connection status");
    }
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

function toolbarModel(overrides: Partial<ToolbarViewModel> = {}): ToolbarViewModel {
  return {
    connected: true,
    status: "Connected.",
    statusState: "ready",
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
    refreshStatus: vi.fn(),
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
