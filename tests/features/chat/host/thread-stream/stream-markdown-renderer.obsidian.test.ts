// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { renderStreamMarkdown } from "../../../../../src/features/chat/host/thread-stream/markdown-renderer.obsidian";
import { installObsidianDomShims } from "../../../../support/dom";

installObsidianDomShims();

describe("renderStreamMarkdown", () => {
  it("keeps link and image notation inert before HTML parsing during streaming", () => {
    const parent = document.createElement("div");
    const parse = vi.spyOn(DOMParser.prototype, "parseFromString");
    try {
      const notation = "[link](https://example.com) ![image](https://example.com/image.png) <https://example.com>";
      renderStreamMarkdown(parent, `**bold** ${notation}`);
      // Disable element generation itself; removing images after parse could already be too late.
      expect(parse).toHaveBeenCalledWith(expect.not.stringMatching(/<(?:a|img)\b/i), "text/html");
      expect(parent.querySelector("strong")?.textContent).toBe("bold");
      expect(parent.textContent).toBe(`bold ${notation}`);
    } finally {
      parse.mockRestore();
    }
  });

  it("escapes raw HTML while streaming", () => {
    const parent = document.createElement("div");
    renderStreamMarkdown(parent, '<img src=x onerror="alert(1)">\n\n<script>alert(1)</script>');
    expect(parent.querySelector("img")).toBeNull();
    expect(parent.querySelector("script")).toBeNull();
    expect(parent.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(parent.textContent).toContain("<script>alert(1)</script>");
  });
});
