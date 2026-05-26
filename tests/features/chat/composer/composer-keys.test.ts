import { describe, expect, it } from "vitest";

import { isComposerSendKey, type ComposerSendKeyEvent } from "../../../../src/shared/ui/keyboard";

const baseEvent: ComposerSendKeyEvent = {
  key: "Enter",
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  isComposing: false,
};

describe("composer send keys", () => {
  it("sends on plain Enter in Enter mode", () => {
    expect(isComposerSendKey(baseEvent, "enter")).toBe(true);
    expect(isComposerSendKey({ ...baseEvent, shiftKey: true }, "enter")).toBe(false);
    expect(isComposerSendKey({ ...baseEvent, metaKey: true }, "enter")).toBe(false);
  });

  it("sends on Cmd/Ctrl+Enter in mod-enter mode", () => {
    expect(isComposerSendKey({ ...baseEvent, metaKey: true }, "mod-enter")).toBe(true);
    expect(isComposerSendKey({ ...baseEvent, ctrlKey: true }, "mod-enter")).toBe(true);
    expect(isComposerSendKey(baseEvent, "mod-enter")).toBe(false);
  });

  it("does not send during composition", () => {
    expect(isComposerSendKey({ ...baseEvent, isComposing: true }, "enter")).toBe(false);
    expect(isComposerSendKey({ ...baseEvent, metaKey: true, isComposing: true }, "mod-enter")).toBe(false);
  });
});
