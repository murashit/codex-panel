// @vitest-environment jsdom

import { act } from "preact/test-utils";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { SendShortcut } from "../../../../../src/domain/input/send-shortcut";
import type { ThreadGoal } from "../../../../../src/domain/threads/goal";
import { GoalPanel, type GoalPanelActions, type GoalPanelEditorState } from "../../../../../src/features/chat/ui/goal/goal";
import { renderUiRoot, unmountUiRoot } from "../../../../../src/shared/ui/preact-root.dom";
import { installObsidianDomShims } from "../../../../support/dom";

installObsidianDomShims();

describe("GoalPanel", () => {
  it.each([true, false])("releases outside-pointer actions before its host is emptied (editing: %s)", async (editing) => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const callbacks = actions();
    try {
      await act(async () => {
        renderUiRoot(
          parent,
          <GoalPanel
            goal={goal()}
            actions={callbacks}
            sendShortcut="enter"
            readOnly={false}
            editor={editing ? { objectiveDraft: "Draft", tokenBudgetDraft: null } : null}
            objectiveExpanded={!editing}
          />,
        );
      });
      parent.replaceChildren();
      // A host rebuild must retire callbacks before Preact's next effect flush.
      document.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      expect(callbacks.onCancelEditing).not.toHaveBeenCalled();
      expect(callbacks.onObjectiveExpandedChange).not.toHaveBeenCalled();
    } finally {
      await act(async () => unmountUiRoot(parent));
      parent.remove();
    }
  });

  it("renders nothing when there is no goal", async () => {
    const parent = document.createElement("div");

    await act(async () => {
      renderGoal(parent, null, actions());
    });

    expect(parent.textContent).toBe("");
  });

  it("renders active goal details and actions", async () => {
    const parent = document.createElement("div");

    await act(async () => {
      renderGoal(parent, goal({ objective: "Ship goal support", tokenBudget: 100, tokensUsed: 12 }), actions());
    });

    expect(parent.textContent).toContain("Goal");
    expect(parent.textContent).toContain("Ship goal support");
    expect(parent.textContent).toContain("12 / 100 tokens");
    expect(parent.querySelector('[aria-label="Goal active"]')).toBeNull();
    expect(parent.querySelector('[aria-label="Pause goal"]')).not.toBeNull();
  });

  it("offers expansion only while clipped through resizing, status changes, and outside-pointer collapse", async () => {
    const parent = document.body.appendChild(document.createElement("div"));
    const callbacks = actions();
    const currentGoal = goal({ objective: "line 1\nline 2\nline 3\nline 4" });
    const measurements = { scrollHeight: 80, clientHeight: 80 };
    mockGoalObjectiveMeasurements(measurements);
    const notifyResize = mockResizeObserver();
    await act(async () => renderGoal(parent, currentGoal, callbacks));
    const content = expectPresent(parent.querySelector<HTMLElement>(".codex-panel__goal-objective"));
    const details = expectPresent(parent.querySelector<HTMLDetailsElement>(".codex-panel__goal-objective-collapse-details"));
    expect(details.hidden).toBe(true);
    expect(content.classList.contains("codex-panel__goal-objective--collapsed")).toBe(false);

    // A narrower layout now clips the same objective; jsdom supplies no geometry.
    measurements.scrollHeight = 120;
    measurements.clientHeight = 90;
    await act(async () => notifyResize());
    expect(details.hidden).toBe(false);
    expect(content.classList.contains("codex-panel__goal-objective--collapsed")).toBe(true);
    expect(details.querySelector("summary")?.textContent).toBe("Show more");

    await act(async () => renderGoal(parent, { ...currentGoal, status: "paused", tokenBudget: 100 }, callbacks));
    expect(details.hidden).toBe(false);
    expect(content.classList.contains("codex-panel__goal-objective--collapsed")).toBe(true);

    await act(async () => {
      details.open = true;
      details.dispatchEvent(new Event("toggle"));
    });
    expect(callbacks.onObjectiveExpandedChange).toHaveBeenCalledWith(true);
    measurements.clientHeight = 120;
    await act(async () => renderGoal(parent, currentGoal, callbacks, "enter", null, true));
    expect(details.hidden).toBe(true);
    expect(content.classList.contains("codex-panel__goal-objective--collapsed")).toBe(false);

    await outsidePointerDown();
    expect(callbacks.onObjectiveExpandedChange).toHaveBeenLastCalledWith(false);
    measurements.clientHeight = 90;
    await act(async () => renderGoal(parent, currentGoal, callbacks));
    expect(details.hidden).toBe(false);
    expect(content.classList.contains("codex-panel__goal-objective--collapsed")).toBe(true);

    measurements.clientHeight = 120;
    await act(async () => renderGoal(parent, currentGoal, callbacks, "enter", null, true));
    measurements.scrollHeight = 80;
    measurements.clientHeight = 80;
    await act(async () => notifyResize());
    expect(details.hidden).toBe(true);
    // Closing the expanded view after widening must not offer a needless expansion.
    await outsidePointerDown();
    await act(async () => renderGoal(parent, currentGoal, callbacks));
    expect(details.hidden).toBe(true);
    expect(content.classList.contains("codex-panel__goal-objective--collapsed")).toBe(false);
  });

  it("requests cancellation from Escape and an outside pointer", async () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const callbacks = actions();
    try {
      await act(async () => {
        renderGoal(parent, goal(), callbacks, "enter", { objectiveDraft: "Changed", tokenBudgetDraft: null });
      });

      await documentKeydown(parent, "Escape");
      expect(callbacks.onCancelEditing).toHaveBeenCalledOnce();
      await outsidePointerDown();
      expect(callbacks.onCancelEditing).toHaveBeenCalledTimes(2);
      expect(callbacks.onSave).not.toHaveBeenCalled();
    } finally {
      unmountUiRoot(parent);
      parent.remove();
    }
  });

  it("resizes the objective editor for supplied measurements and saves with the configured shortcut", async () => {
    const measuredHeight = vi.spyOn(HTMLTextAreaElement.prototype, "scrollHeight", "get").mockReturnValue(90);
    const parent = document.createElement("div");
    try {
      const callbacks = actions();

      await act(async () => {
        renderGoal(parent, goal(), callbacks, "enter", { objectiveDraft: "Draft", tokenBudgetDraft: null });
      });
      const textarea = expectPresent(parent.querySelector<HTMLTextAreaElement>("textarea"));
      await input(parent, "textarea", "line 1\nline 2\nline 3");

      expect(textarea.style.height).toBe("90px");
      expect(textarea.style.overflowY).toBe("hidden");

      // Exercise the edit-to-measurement binding; jsdom does not measure the text itself.
      measuredHeight.mockReturnValue(300);
      await input(parent, "textarea", "long objective");
      expect(textarea.style.height).toBe("180px");
      expect(textarea.style.overflowY).toBe("auto");
      measuredHeight.mockReturnValue(90);
      await input(parent, "textarea", "line 1\nline 2\nline 3");
      expect(textarea.style.height).toBe("90px");
      expect(textarea.style.overflowY).toBe("hidden");

      expect(callbacks.onObjectiveDraftChange).toHaveBeenLastCalledWith("line 1\nline 2\nline 3");
      await act(async () => {
        renderGoal(parent, goal(), callbacks, "enter", { objectiveDraft: "line 1\nline 2\nline 3", tokenBudgetDraft: null });
      });
      await textareaKeydown(parent, { key: "Enter" });
      expect(callbacks.onSave).toHaveBeenCalledWith("line 1\nline 2\nline 3", null);

      const modCallbacks = actions();
      await act(async () => {
        renderGoal(parent, goal(), modCallbacks, "mod-enter", { objectiveDraft: "mod save", tokenBudgetDraft: null });
      });
      await textareaKeydown(parent, { key: "Enter" });
      expect(modCallbacks.onSave).not.toHaveBeenCalled();
      await textareaKeydown(parent, { key: "Enter", metaKey: true });
      expect(modCallbacks.onSave).toHaveBeenCalledWith("mod save", null);
    } finally {
      unmountUiRoot(parent);
      measuredHeight.mockRestore();
    }
  });

  it("does not show pause or resume for terminal statuses", async () => {
    const parent = document.createElement("div");

    await act(async () => {
      renderGoal(parent, goal({ status: "complete" }), actions());
    });

    expect(parent.querySelector('[aria-label="Pause goal"]')).toBeNull();
    expect(parent.querySelector('[aria-label="Resume goal"]')).toBeNull();
    expect(parent.querySelector('[aria-label="Clear goal"]')).not.toBeNull();
  });
});

function renderGoal(
  parent: HTMLElement,
  currentGoal: ThreadGoal | null,
  callbacks: GoalPanelActions = actions(),
  sendShortcut: SendShortcut = "enter",
  editor: GoalPanelEditorState | null = null,
  objectiveExpanded = false,
): void {
  onTestFinished(() => {
    unmountUiRoot(parent);
    parent.remove();
  });
  renderUiRoot(
    parent,
    <GoalPanel
      goal={currentGoal}
      actions={callbacks}
      sendShortcut={sendShortcut}
      readOnly={false}
      editor={editor}
      objectiveExpanded={objectiveExpanded}
    />,
  );
}

function actions(): GoalPanelActions {
  return {
    onSave: vi.fn(),
    onPause: vi.fn(),
    onResume: vi.fn(),
    onClear: vi.fn(),
    onStartEditing: vi.fn(),
    onCancelEditing: vi.fn(),
    onObjectiveDraftChange: vi.fn(),
    onObjectiveExpandedChange: vi.fn(),
  };
}

function goal(overrides: Partial<ThreadGoal> = {}): ThreadGoal {
  return {
    threadId: "thread",
    objective: "Finish",
    status: "active",
    tokenBudget: null,
    tokensUsed: 0,
    timeUsedSeconds: 0,
    ...overrides,
  };
}

async function input(parent: HTMLElement, selector: string, value: string): Promise<void> {
  const element = parent.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  await act(async () => {
    element.value = value;
    element.dispatchEvent(new InputEvent("input", { bubbles: true }));
  });
}

async function documentKeydown(parent: HTMLElement, key: string): Promise<void> {
  if (!parent.isConnected) throw new Error("Parent must be connected");
  await act(async () => {
    parent.ownerDocument.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key }));
  });
}

async function outsidePointerDown(): Promise<void> {
  await act(async () => {
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  });
}

function mockGoalObjectiveMeasurements(measurements: { scrollHeight: number; clientHeight: number }): void {
  const scrollHeight = vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(() => measurements.scrollHeight);
  const clientHeight = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => measurements.clientHeight);
  onTestFinished(() => {
    scrollHeight.mockRestore();
    clientHeight.mockRestore();
  });
}

function mockResizeObserver(): () => void {
  const original = window.ResizeObserver;
  const callbacks = new Set<() => void>();
  class TestResizeObserver implements ResizeObserver {
    private readonly notify: () => void;
    constructor(callback: ResizeObserverCallback) {
      this.notify = () => callback([], this);
    }

    observe(): void {
      callbacks.add(this.notify);
    }
    unobserve(): void {
      callbacks.delete(this.notify);
    }
    disconnect(): void {
      callbacks.delete(this.notify);
    }
  }
  window.ResizeObserver = TestResizeObserver;
  onTestFinished(() => {
    window.ResizeObserver = original;
  });
  return () => {
    for (const callback of callbacks) callback();
  };
}

async function textareaKeydown(
  parent: HTMLElement,
  options: { key: string; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; isComposing?: boolean },
): Promise<void> {
  const element = parent.querySelector<HTMLTextAreaElement>("textarea");
  if (!element) throw new Error("Missing textarea");
  await act(async () => {
    element.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        key: options.key,
        metaKey: options.metaKey ?? false,
        ctrlKey: options.ctrlKey ?? false,
        shiftKey: options.shiftKey ?? false,
        altKey: options.altKey ?? false,
        isComposing: options.isComposing ?? false,
      }),
    );
  });
}

function expectPresent<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected value to be present");
  return value;
}
