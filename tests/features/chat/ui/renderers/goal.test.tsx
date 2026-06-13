// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { act } from "preact/test-utils";
import { useState } from "preact/hooks";

import type { ThreadGoal } from "../../../../../src/domain/threads/goal";
import { GoalPanel, type GoalPanelActions, type GoalPanelEditorState } from "../../../../../src/features/chat/ui/goal";
import type { SendShortcut } from "../../../../../src/shared/ui/keyboard";
import { renderUiRoot } from "../../../../../src/shared/ui/ui-root";
import { installObsidianDomShims } from "../../../../support/dom";

installObsidianDomShims();
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("GoalPanel", () => {
  it("renders nothing when there is no goal", async () => {
    const parent = document.createElement("div");

    await act(async () => {
      renderGoal(parent, null, actions());
    });

    expect(parent.textContent).toBe("");
  });

  it("opens an empty goal editor when editing is requested without a saved goal", async () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const callbacks = actions();

    await act(async () => {
      renderGoal(parent, null, callbacks, "enter", { editing: true, objectiveDraft: "", tokenBudgetDraft: null });
    });

    expect(parent.textContent).toContain("Goal");
    expect(document.activeElement).toBe(parent.querySelector("textarea"));
    expect(parent.querySelector("textarea")?.getAttribute("aria-label")).toBe("Goal objective");
    await input(parent, "textarea", "New objective");
    await click(parent, '[aria-label="Save goal"]');

    expect(callbacks.onSave).toHaveBeenCalledWith("New objective", null);
    parent.remove();
  });

  it("renders active goal details and actions", async () => {
    const parent = document.createElement("div");

    await act(async () => {
      renderGoal(parent, goal({ objective: "Ship goal support", tokenBudget: 100, tokensUsed: 12 }), actions());
    });

    expect(parent.textContent).toContain("Goal");
    expect(parent.textContent).toContain("Ship goal support");
    expect(parent.textContent).toContain("12 / 100 tokens");
    expect(parent.querySelector(".codex-panel__goal--active")).not.toBeNull();
    expect(parent.querySelector('[aria-label="Goal active"]')).toBeNull();
    expect(parent.querySelector('[aria-label="Pause goal"]')).not.toBeNull();
  });

  it("collapses long objectives, expands from the message-style control, and recollapses on outside pointer", async () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);

    await withGoalObjectiveScrollHeight(100, async () => {
      await act(async () => {
        renderGoal(parent, goal({ objective: "line 1\nline 2\nline 3\nline 4" }), actions());
      });

      const content = expectPresent(parent.querySelector<HTMLElement>(".codex-panel__goal-objective"));
      const details = expectPresent(parent.querySelector<HTMLDetailsElement>(".codex-panel__goal-objective-collapse-details"));

      expect(content.classList.contains("codex-panel__goal-objective--collapsed")).toBe(true);
      expect(details.hidden).toBe(false);
      expect(details.querySelector("summary")?.textContent).toBe("Show more");

      await act(async () => {
        details.open = true;
        details.dispatchEvent(new Event("toggle"));
      });
      expect(content.classList.contains("codex-panel__goal-objective--collapsed")).toBe(false);
      expect(details.hidden).toBe(true);

      await outsidePointerDown();
      expect(content.classList.contains("codex-panel__goal-objective--collapsed")).toBe(true);
      expect(details.hidden).toBe(false);
    });

    parent.remove();
  });

  it("does not show the collapse control for short objectives", async () => {
    const parent = document.createElement("div");

    await withGoalObjectiveScrollHeight(40, async () => {
      await act(async () => {
        renderGoal(parent, goal({ objective: "short" }), actions());
      });
    });

    expect(parent.querySelector(".codex-panel__goal-objective")?.classList.contains("codex-panel__goal-objective--collapsed")).toBe(false);
    expect(parent.querySelector<HTMLDetailsElement>(".codex-panel__goal-objective-collapse-details")?.hidden).toBe(true);
  });

  it("saves inline edits from the editor frame icon while preserving the existing token budget", async () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const callbacks = actions();

    await act(async () => {
      renderGoal(parent, goal({ tokenBudget: 250 }), callbacks);
    });
    await click(parent, '[aria-label="Edit goal"]');
    expect(document.activeElement).toBe(parent.querySelector("textarea"));
    await input(parent, "textarea", "Updated objective");
    await click(parent, '[aria-label="Save goal"]');

    expect(parent.querySelector("textarea")).toBeNull();
    expect(parent.querySelector('[aria-label="Save goal"]')).toBeNull();
    expect(callbacks.onSave).toHaveBeenCalledWith("Updated objective", 250);
    parent.remove();
  });

  it("keeps an in-progress edit open across usage-only goal updates", async () => {
    const parent = document.createElement("div");
    const callbacks = actions();
    const currentGoal = goal({ objective: "Original", tokensUsed: 1, timeUsedSeconds: 2 });

    await act(async () => {
      renderGoal(parent, currentGoal, callbacks);
    });
    await click(parent, '[aria-label="Edit goal"]');
    await input(parent, "textarea", "Draft objective");

    await act(async () => {
      renderGoal(parent, { ...currentGoal, tokensUsed: 99, timeUsedSeconds: 120 }, callbacks);
    });

    expect(parent.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("Draft objective");
  });

  it("cancels inline edits from Escape or an outside pointer", async () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const callbacks = actions();

    await act(async () => {
      renderGoal(parent, goal({ objective: "Original" }), callbacks);
    });
    await click(parent, '[aria-label="Edit goal"]');
    await input(parent, "textarea", "Changed");
    await documentKeydown(parent, "Escape");

    expect(callbacks.onSave).not.toHaveBeenCalled();
    expect(parent.querySelector("textarea")).toBeNull();
    expect(parent.textContent).toContain("Original");

    await click(parent, '[aria-label="Edit goal"]');
    await input(parent, "textarea", "Changed again");
    await outsidePointerDown();

    expect(callbacks.onSave).not.toHaveBeenCalled();
    expect(parent.querySelector("textarea")).toBeNull();
    expect(parent.textContent).toContain("Original");
    parent.remove();
  });

  it("autogrows the objective editor and saves with the configured composer send shortcut", async () => {
    const parent = document.createElement("div");
    const callbacks = actions();

    await act(async () => {
      renderGoal(parent, goal(), callbacks, "enter");
    });
    await click(parent, '[aria-label="Edit goal"]');
    const textarea = expectPresent(parent.querySelector<HTMLTextAreaElement>("textarea"));
    await input(parent, "textarea", "line 1\nline 2\nline 3");

    expect(textarea.style.height).not.toBe("");
    expect(textarea.style.overflowY).toBe("hidden");

    await textareaKeydown(parent, { key: "Enter" });
    expect(callbacks.onSave).toHaveBeenCalledWith("line 1\nline 2\nline 3", null);
    expect(parent.querySelector("textarea")).toBeNull();

    const modCallbacks = actions();
    await act(async () => {
      renderGoal(parent, goal({ objective: "Saved objective" }), modCallbacks, "mod-enter");
    });
    await click(parent, '[aria-label="Edit goal"]');
    await input(parent, "textarea", "mod save");
    await textareaKeydown(parent, { key: "Enter" });
    expect(modCallbacks.onSave).not.toHaveBeenCalled();
    await textareaKeydown(parent, { key: "Enter", metaKey: true });
    expect(modCallbacks.onSave).toHaveBeenCalledWith("mod save", null);
  });

  it("routes pause, resume, and clear actions", async () => {
    const parent = document.createElement("div");
    const callbacks = actions();

    await act(async () => {
      renderGoal(parent, goal({ status: "active" }), callbacks);
    });
    await click(parent, '[aria-label="Pause goal"]');
    expect(callbacks.onPause).toHaveBeenCalledOnce();

    await act(async () => {
      renderGoal(parent, goal({ status: "paused" }), callbacks);
    });
    await click(parent, '[aria-label="Resume goal"]');
    expect(callbacks.onResume).toHaveBeenCalledOnce();

    await click(parent, '[aria-label="Clear goal"]');
    expect(callbacks.onClear).toHaveBeenCalledOnce();
  });

  it("does not show pause or resume for terminal statuses", async () => {
    const parent = document.createElement("div");

    await act(async () => {
      renderGoal(parent, goal({ status: "complete" }), actions());
    });

    expect(parent.textContent).not.toContain("complete");
    expect(parent.querySelector(".codex-panel__goal--complete")).not.toBeNull();
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
  initialEditor?: GoalPanelEditorState,
): void {
  const harnessProps = {
    goal: currentGoal,
    actions: callbacks,
    sendShortcut,
    ...(initialEditor ? { initialEditor } : {}),
  };
  renderUiRoot(parent, <GoalPanelHarness {...harnessProps} />);
}

function GoalPanelHarness({
  goal,
  actions: callbacks,
  sendShortcut,
  initialEditor,
}: {
  goal: ThreadGoal | null;
  actions: GoalPanelActions;
  sendShortcut: SendShortcut;
  initialEditor?: GoalPanelEditorState;
}) {
  const [editor, setEditor] = useState<GoalPanelEditorState>(
    initialEditor ?? { editing: false, objectiveDraft: "", tokenBudgetDraft: goal?.tokenBudget ?? null },
  );
  const [objectiveExpanded, setObjectiveExpanded] = useState(false);
  const actions: GoalPanelActions = {
    ...callbacks,
    onStartEditing: () => {
      callbacks.onStartEditing();
      setEditor({ editing: true, objectiveDraft: goal?.objective ?? "", tokenBudgetDraft: goal?.tokenBudget ?? null });
    },
    onCancelEditing: () => {
      callbacks.onCancelEditing();
      setEditor({ editing: false, objectiveDraft: "", tokenBudgetDraft: goal?.tokenBudget ?? null });
    },
    onObjectiveDraftChange: (objective) => {
      callbacks.onObjectiveDraftChange(objective);
      setEditor((current) => ({ ...current, objectiveDraft: objective }));
    },
    onSave: (objective, tokenBudget) => {
      callbacks.onSave(objective, tokenBudget);
      setEditor({ editing: false, objectiveDraft: "", tokenBudgetDraft: goal?.tokenBudget ?? null });
    },
    onObjectiveExpandedChange: (expanded) => {
      callbacks.onObjectiveExpandedChange(expanded);
      setObjectiveExpanded(expanded);
    },
  };
  return <GoalPanel goal={goal} actions={actions} options={{ sendShortcut }} editor={editor} display={{ objectiveExpanded }} />;
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
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

async function click(parent: HTMLElement, selector: string): Promise<void> {
  const element = parent.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  await act(async () => {
    element.click();
  });
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

async function withGoalObjectiveScrollHeight<T>(scrollHeight: number, fn: () => Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get() {
      return this.classList.contains("codex-panel__goal-objective") ? scrollHeight : 0;
    },
  });
  try {
    return await fn();
  } finally {
    if (descriptor) {
      Object.defineProperty(HTMLElement.prototype, "scrollHeight", descriptor);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "scrollHeight");
    }
  }
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
