import { describe, expect, it } from "vitest";

import { type ComposerSendKeyEvent, isComposerSendKey } from "../../../src/shared/ui/keyboard";

const baseEvent: ComposerSendKeyEvent = {
  key: "Enter",
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  isComposing: false,
};

describe("composer send keys", () => {
  it.each([
    { name: "plain Enter", event: baseEvent, shortcut: "enter", expected: true },
    { name: "Shift+Enter", event: { ...baseEvent, shiftKey: true }, shortcut: "enter", expected: false },
    { name: "Meta+Enter", event: { ...baseEvent, metaKey: true }, shortcut: "enter", expected: false },
  ] as const)("checks $name in Enter mode", ({ event, shortcut, expected }) => {
    expect(isComposerSendKey(event, shortcut)).toBe(expected);
  });

  it.each([
    { name: "Meta+Enter", event: { ...baseEvent, metaKey: true }, shortcut: "mod-enter", expected: true },
    { name: "Ctrl+Enter", event: { ...baseEvent, ctrlKey: true }, shortcut: "mod-enter", expected: true },
    { name: "plain Enter", event: baseEvent, shortcut: "mod-enter", expected: false },
  ] as const)("checks $name in Cmd/Ctrl+Enter mode", ({ event, shortcut, expected }) => {
    expect(isComposerSendKey(event, shortcut)).toBe(expected);
  });

  it.each([
    { name: "Enter mode", event: { ...baseEvent, isComposing: true }, shortcut: "enter" },
    { name: "Cmd/Ctrl+Enter mode", event: { ...baseEvent, metaKey: true, isComposing: true }, shortcut: "mod-enter" },
  ] as const)("does not send during composition in $name", ({ event, shortcut }) => {
    expect(isComposerSendKey(event, shortcut)).toBe(false);
  });
});
