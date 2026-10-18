// @vitest-environment jsdom

import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";
import { ConversationHeader } from "../../../../../src/features/chat/ui/header/header";
import { renderUiRoot, unmountUiRoot } from "../../../../../src/shared/ui/preact-root.dom";

describe("conversation header", () => {
  it("exposes a draft choice and disables it while creation is pending", async () => {
    const parent = document.createElement("div");
    const onToggle = vi.fn();
    try {
      for (const ephemeral of [false, true]) {
        await act(async () => {
          renderUiRoot(
            parent,
            <ConversationHeader title="New chat" persistence={{ kind: "selectable", ephemeral, disabled: false, onToggle }} />,
          );
        });
        const button = parent.querySelector("button");
        expect(button?.getAttribute("aria-label")).toBe(ephemeral ? "Use regular conversation" : "Use temporary conversation");
        expect(button?.hasAttribute("aria-pressed")).toBe(false);
        expect(button?.type).toBe("button");
        expect(button?.parentElement?.firstElementChild).toBe(button);
        expect(button?.nextElementSibling?.textContent).toBe("New chat");
        expect(button?.dataset["icon"]).toBe(ephemeral ? "message-square-dashed" : "message-square");
        button?.click();
      }
      expect(onToggle).toHaveBeenCalledTimes(2);

      await act(async () => {
        renderUiRoot(
          parent,
          <ConversationHeader title="New chat" persistence={{ kind: "selectable", ephemeral: true, disabled: true, onToggle }} />,
        );
      });
      const button = parent.querySelector("button");
      expect(button?.disabled).toBe(true);
      button?.click();
      expect(onToggle).toHaveBeenCalledTimes(2);
    } finally {
      unmountUiRoot(parent);
    }
  });

  it.each([false, true, null])("keeps fixed or unknown conversation identity noninteractive (temporary: %s)", async (ephemeral) => {
    const parent = document.createElement("div");
    const title = "A long conversation name that stays available to assistive technology";
    try {
      await act(async () => {
        renderUiRoot(parent, <ConversationHeader title={title} persistence={ephemeral === null ? null : { kind: "fixed", ephemeral }} />);
      });
      expect(parent.textContent).toBe(title);
      expect(parent.querySelector("button, [tabindex], [title]")).toBeNull();
      const indicator = parent.querySelector(".codex-panel__conversation-persistence");
      expect(indicator?.parentElement?.firstElementChild).toBe(indicator);
      expect(indicator?.nextElementSibling?.textContent).toBe(title);
      if (ephemeral === null) {
        expect(indicator?.getAttribute("aria-hidden")).toBe("true");
        expect(indicator?.hasAttribute("aria-label")).toBe(false);
      } else {
        expect(indicator?.getAttribute("aria-label")).toBe(ephemeral ? "Temporary conversation" : "Regular conversation");
      }
    } finally {
      unmountUiRoot(parent);
    }
  });
});
