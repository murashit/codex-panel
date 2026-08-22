// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
  ThreadAutoNameButton,
  ThreadRenameInput,
  ThreadRowControls,
  type ThreadRowControlsProps,
} from "../../../../src/features/threads/list/row-controls.dom";
import { renderUiRoot } from "../../../../src/shared/dom/preact-root.dom";
import { changeInputValue } from "../../../support/dom";

function expectPresent<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected value to be present");
  return value;
}

function rowControlProps(overrides: Partial<ThreadRowControlsProps> = {}): ThreadRowControlsProps {
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

describe("shared thread row controls", () => {
  it("keeps rename, archive, and pin actions ordered and isolated from row navigation", () => {
    const parent = document.createElement("div");
    const rowClick = vi.fn();
    const props = rowControlProps();
    parent.addEventListener("click", rowClick);

    renderUiRoot(parent, <ThreadRowControls {...props} />);

    const buttons = [...parent.querySelectorAll<HTMLButtonElement>("button")];
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual(["Rename thread", "Archive thread", "Pin thread"]);
    expect(buttons.at(-1)?.getAttribute("aria-pressed")).toBe("false");
    for (const button of buttons) button.click();
    expect(props.onRename).toHaveBeenCalledOnce();
    expect(props.onArchiveStart).toHaveBeenCalledOnce();
    expect(props.onPinChange).toHaveBeenCalledWith(true);
    expect(rowClick).not.toHaveBeenCalled();

    renderUiRoot(parent, <ThreadRowControls {...props} isPinned={true} />);
    const unpin = expectPresent(parent.querySelector<HTMLButtonElement>('[aria-label="Unpin thread"]'));
    expect(unpin.getAttribute("aria-pressed")).toBe("true");
    expect(unpin.classList.contains("surface-pin-active")).toBe(true);
    unpin.click();
    expect(props.onPinChange).toHaveBeenLastCalledWith(false);
  });

  it("replaces row actions with the default and alternate archive modes", () => {
    const parent = document.createElement("div");
    const onArchiveConfirm = vi.fn();
    const props = rowControlProps({
      archiveConfirm: { active: true, defaultSaveMarkdown: false },
      onArchiveConfirm,
    });

    renderUiRoot(parent, <ThreadRowControls {...props} />);

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

    renderUiRoot(parent, <ThreadRowControls {...props} archiveDisabled={true} />);
    const disabledButtons = [...parent.querySelectorAll<HTMLButtonElement>("button")];
    expect(disabledButtons.every((button) => button.disabled)).toBe(true);
    for (const button of disabledButtons) button.click();
    expect(onArchiveConfirm).toHaveBeenCalledTimes(2);
  });

  it("owns the rename input focus, IME, save, cancel, and busy protocol", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const onUpdate = vi.fn();
    const onSave = vi.fn();
    const onCancel = vi.fn();
    const render = (value: string, busy = false) => {
      renderUiRoot(
        parent,
        <ThreadRenameInput className="surface-input" value={value} busy={busy} onUpdate={onUpdate} onSave={onSave} onCancel={onCancel} />,
      );
    };

    render("Old name");
    let input = expectPresent(parent.querySelector<HTMLInputElement>("input"));
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, input.value.length]);
    changeInputValue(input, "New name");
    expect(onUpdate).toHaveBeenCalledWith("New name");

    render("New name");
    input = expectPresent(parent.querySelector<HTMLInputElement>("input"));
    input.dispatchEvent(new FocusEvent("blur"));
    expect(onSave).toHaveBeenCalledWith("New name");
    onSave.mockClear();
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, isComposing: true }));
    expect(onSave).not.toHaveBeenCalled();
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onSave).toHaveBeenCalledWith("New name");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onCancel).toHaveBeenCalledOnce();

    onSave.mockClear();
    onCancel.mockClear();
    render("New name", true);
    input = expectPresent(parent.querySelector<HTMLInputElement>("input"));
    expect(input.disabled).toBe(true);
    input.dispatchEvent(new FocusEvent("blur"));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onSave).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    parent.remove();
  });

  it("keeps auto-name pointer focus in the editor and switches between start and cancel", () => {
    const parent = document.createElement("div");
    const rowPointerDown = vi.fn();
    const rowClick = vi.fn();
    const onStart = vi.fn();
    const onCancel = vi.fn();
    parent.addEventListener("pointerdown", rowPointerDown);
    parent.addEventListener("click", rowClick);
    const render = (generating: boolean, saving = false, autoNameDisabled = false) => {
      renderUiRoot(
        parent,
        <ThreadAutoNameButton
          className="surface-action"
          generating={generating}
          saving={saving}
          autoNameDisabled={autoNameDisabled}
          onStart={onStart}
          onCancel={onCancel}
        />,
      );
    };

    render(false);
    let button = expectPresent(parent.querySelector<HTMLButtonElement>('[aria-label="Auto-name thread"]'));
    const pointerDown = new Event("pointerdown", { bubbles: true, cancelable: true });
    button.dispatchEvent(pointerDown);
    button.click();
    expect(pointerDown.defaultPrevented).toBe(true);
    expect(rowPointerDown).not.toHaveBeenCalled();
    expect(rowClick).not.toHaveBeenCalled();
    expect(onStart).toHaveBeenCalledOnce();

    render(true, false, true);
    button = expectPresent(parent.querySelector<HTMLButtonElement>('[aria-label="Cancel auto-name"]'));
    expect(button.disabled).toBe(false);
    button.click();
    expect(onCancel).toHaveBeenCalledOnce();

    render(false, true);
    button = expectPresent(parent.querySelector<HTMLButtonElement>('[aria-label="Auto-name thread"]'));
    expect(button.disabled).toBe(true);
  });
});
