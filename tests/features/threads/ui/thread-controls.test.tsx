// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
  ThreadActionControls,
  type ThreadActionControlsProps,
  threadRenameControls,
} from "../../../../src/features/threads/ui/thread-controls.dom";
import { renderUiRoot, unmountUiRoot } from "../../../../src/shared/ui/preact-root.dom";
import { changeInputValue } from "../../../support/dom";

function expectPresent<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected value to be present");
  return value;
}

function threadActionProps(overrides: Partial<ThreadActionControlsProps> = {}): ThreadActionControlsProps {
  return {
    isPinned: false,
    archiveConfirm: { active: false, defaultSaveMarkdown: false },
    classNames: {
      action: "surface-action",
      pin: "surface-pin",
      pinned: "surface-pin-active",
      archivePrimary: "surface-archive-primary",
      archiveAlternate: "surface-archive-alternate",
    },
    onRename: vi.fn(),
    onPinChange: vi.fn(),
    onArchiveStart: vi.fn(),
    onArchiveConfirm: vi.fn(),
    ...overrides,
  };
}

function renameProps(): Parameters<typeof threadRenameControls>[0] {
  return {
    state: { draft: "Title", generating: false, saving: false, autoNameDisabled: false },
    classNames: { input: "surface-input", action: "surface-action" },
    threadId: "thread",
    actions: {
      updateDraft: vi.fn(),
      save: vi.fn(),
      cancel: vi.fn(),
      autoName: vi.fn(),
      cancelAutoName: vi.fn(),
    },
  };
}

function renderRename(parent: HTMLElement, props: Parameters<typeof threadRenameControls>[0]): void {
  const controls = threadRenameControls(props);
  renderUiRoot(
    parent,
    <fieldset onFocusOut={controls.onFocusOut} onKeyDown={controls.onKeyDown}>
      {controls.input}
      {controls.action}
    </fieldset>,
  );
}

describe("shared thread controls", () => {
  it("keeps rename, archive, and pin actions ordered and isolated from row navigation", () => {
    const parent = document.createElement("div");
    const rowClick = vi.fn();
    const props = threadActionProps();
    parent.addEventListener("click", rowClick);

    renderUiRoot(parent, <ThreadActionControls {...props} />);

    const buttons = [...parent.querySelectorAll<HTMLButtonElement>("button")];
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual(["Rename thread", "Archive thread", "Pin thread"]);
    expect(buttons.at(-1)?.getAttribute("aria-pressed")).toBe("false");
    expectPresent(parent.querySelector<HTMLButtonElement>('[aria-label="Rename thread"]')).click();
    expect(props.onRename).toHaveBeenCalledExactlyOnceWith();
    expect(props.onArchiveStart).not.toHaveBeenCalled();
    expect(props.onPinChange).not.toHaveBeenCalled();

    expectPresent(parent.querySelector<HTMLButtonElement>('[aria-label="Archive thread"]')).click();
    expect(props.onArchiveStart).toHaveBeenCalledOnce();
    expect(props.onRename).toHaveBeenCalledOnce();
    expect(props.onPinChange).not.toHaveBeenCalled();

    expectPresent(parent.querySelector<HTMLButtonElement>('[aria-label="Pin thread"]')).click();
    expect(props.onPinChange).toHaveBeenCalledExactlyOnceWith(true);
    expect(props.onRename).toHaveBeenCalledOnce();
    expect(props.onArchiveStart).toHaveBeenCalledOnce();
    expect(rowClick).not.toHaveBeenCalled();

    renderUiRoot(parent, <ThreadActionControls {...props} isPinned={true} />);
    const unpin = expectPresent(parent.querySelector<HTMLButtonElement>('[aria-label="Unpin thread"]'));
    expect(unpin.getAttribute("aria-pressed")).toBe("true");
    expect(unpin.classList.contains("surface-pin-active")).toBe(true);
    unpin.click();
    expect(props.onPinChange).toHaveBeenLastCalledWith(false);
  });

  it("replaces row actions with the default and alternate archive modes", () => {
    const parent = document.createElement("div");
    const onArchiveConfirm = vi.fn();
    const props = threadActionProps({
      archiveConfirm: { active: true, defaultSaveMarkdown: false },
      onArchiveConfirm,
    });

    renderUiRoot(parent, <ThreadActionControls {...props} />);

    const buttons = [...parent.querySelectorAll<HTMLButtonElement>("button")];
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Archive thread without saving",
      "Save and archive thread",
    ]);
    expect(buttons[0]?.classList.contains("surface-archive-primary")).toBe(true);
    expect(buttons[1]?.classList.contains("surface-archive-alternate")).toBe(true);
    buttons[0]?.click();
    buttons[1]?.click();
    expect(onArchiveConfirm.mock.calls).toEqual([[false], [true]]);

    renderUiRoot(parent, <ThreadActionControls {...props} archiveDisabled={true} />);
    const disabledButtons = [...parent.querySelectorAll<HTMLButtonElement>("button")];
    expect(disabledButtons.every((button) => button.disabled)).toBe(true);
    for (const button of disabledButtons) button.click();
    expect(onArchiveConfirm).toHaveBeenCalledTimes(2);
  });

  it("does not transfer archive focus for existing list controls", () => {
    const parent = document.body.appendChild(document.createElement("div"));
    const props = threadActionProps();
    try {
      renderUiRoot(parent, <ThreadActionControls {...props} />);
      const archive = expectPresent(parent.querySelector<HTMLButtonElement>('[aria-label="Archive thread"]'));
      archive.focus();
      archive.click();
      renderUiRoot(parent, <ThreadActionControls {...props} archiveConfirm={{ active: true, defaultSaveMarkdown: true }} />);
      const primary = expectPresent(parent.querySelector<HTMLButtonElement>('[aria-label="Save and archive thread"]'));
      expect(document.activeElement).not.toBe(primary);
    } finally {
      unmountUiRoot(parent);
      parent.remove();
    }
  });

  it("keeps accessible names and action targets distinct across separate roots", () => {
    const first = document.body.appendChild(document.createElement("div"));
    const second = document.body.appendChild(document.createElement("div"));
    const props = renameProps();
    try {
      renderRename(first, { ...props, threadId: "first" });
      renderRename(second, { ...props, threadId: "second" });
      const inputs = [first, second].map((parent) => expectPresent(parent.querySelector<HTMLInputElement>("input")));
      for (const input of inputs) changeInputValue(input, "New title");
      expect(props.actions.updateDraft).toHaveBeenNthCalledWith(1, "first", "New title");
      expect(props.actions.updateDraft).toHaveBeenNthCalledWith(2, "second", "New title");
      const ids = inputs.map((input) => input.getAttribute("aria-labelledby"));
      expect(ids[0]).not.toBe(ids[1]);
      for (const id of ids) {
        expect(id && document.getElementById(id)?.textContent).toBe("Thread name");
      }
    } finally {
      unmountUiRoot(first);
      unmountUiRoot(second);
      first.remove();
      second.remove();
    }
  });

  it("owns rename focus, keyboard and pointer actions, and auto-name busy transitions", () => {
    const parent = document.body.appendChild(document.createElement("div"));
    const props = renameProps();
    const rowPointerDown = vi.fn();
    const rowClick = vi.fn();
    parent.addEventListener("pointerdown", rowPointerDown);
    parent.addEventListener("click", rowClick);
    const render = (state: Partial<typeof props.state>) => {
      props.state = { ...props.state, ...state };
      renderRename(parent, props);
    };

    try {
      render({ draft: "Old name" });
      const input = expectPresent(parent.querySelector<HTMLInputElement>("input"));
      expect(document.activeElement).toBe(input);
      expect([input.selectionStart, input.selectionEnd]).toEqual([0, input.value.length]);
      changeInputValue(input, "New name");
      expect(props.actions.updateDraft).toHaveBeenCalledWith("thread", "New name");

      render({ draft: "New name" });
      const autoName = expectPresent(parent.querySelector<HTMLButtonElement>("button"));
      autoName.focus();
      expect(document.activeElement).toBe(autoName);
      expect(props.actions.save).not.toHaveBeenCalled();
      autoName.blur();
      expect(props.actions.save).toHaveBeenCalledExactlyOnceWith("thread", "New name");
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, isComposing: true }));
      expect(props.actions.save).toHaveBeenCalledOnce();
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      expect(props.actions.save).toHaveBeenNthCalledWith(2, "thread", "New name");
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      expect(props.actions.cancel).toHaveBeenCalledExactlyOnceWith("thread");

      const pointerDown = new Event("pointerdown", { bubbles: true, cancelable: true });
      autoName.dispatchEvent(pointerDown);
      autoName.click();
      expect(pointerDown.defaultPrevented).toBe(true);
      expect(rowPointerDown).not.toHaveBeenCalled();
      expect(rowClick).not.toHaveBeenCalled();
      expect(props.actions.autoName).toHaveBeenCalledExactlyOnceWith("thread");

      render({ generating: true, autoNameDisabled: true });
      expect(input.disabled).toBe(true);
      const cancelAutoName = expectPresent(parent.querySelector<HTMLButtonElement>('[aria-label="Cancel auto-name"]'));
      expect(cancelAutoName.disabled).toBe(false);
      cancelAutoName.focus();
      cancelAutoName.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      cancelAutoName.blur();
      expect(props.actions.save).toHaveBeenCalledTimes(2);
      expect(props.actions.cancel).toHaveBeenCalledExactlyOnceWith("thread");
      cancelAutoName.click();
      expect(props.actions.cancelAutoName).toHaveBeenCalledExactlyOnceWith("thread");

      render({ generating: false, saving: true });
      expect(parent.querySelector<HTMLButtonElement>('[aria-label="Auto-name thread"]')?.disabled).toBe(true);
    } finally {
      unmountUiRoot(parent);
      parent.remove();
    }
  });
});
