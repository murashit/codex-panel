// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { renderStreamMarkdown } from "../../../../../src/features/chat/host/thread-stream/markdown-renderer.obsidian";
import { installObsidianDomShims } from "../../../../support/dom";

installObsidianDomShims();

describe("renderStreamMarkdown", () => {
  it("renders formatting without activating links during streaming", () => {
    const parent = document.createElement("div");
    renderStreamMarkdown(parent, "# Title\n\n**bold** [web](https://example.com) [file](file:///tmp/Note.md) [[Wiki]]");
    expect(parent.querySelector("h1")?.textContent).toBe("Title");
    expect(parent.querySelector("strong")?.textContent).toBe("bold");
    expect(parent.querySelector("a")).toBeNull();
    expect(parent.textContent).toContain("web file [[Wiki]]");
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
