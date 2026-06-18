// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";

import { StreamMarkdownMessageRenderer } from "../../../../../src/features/chat/ui/message-stream/stream-markdown-renderer";
import { notices } from "../../../../mocks/obsidian";
import { installObsidianDomShims } from "../../../../support/dom";

installObsidianDomShims();

describe("StreamMarkdownMessageRenderer", () => {
  beforeEach(() => {
    notices.length = 0;
  });

  it("renders basic markdown through micromark", () => {
    const renderer = streamMarkdownRenderer();
    const parent = document.createElement("div");

    renderer.renderStreamMarkdown(parent, "# Title\n\n**bold** text");

    expect(parent.querySelector("h1")?.textContent).toBe("Title");
    expect(parent.querySelector("strong")?.textContent).toBe("bold");
    expect(parent.textContent).toBe("Title\nbold text");
  });

  it("leaves wikilinks as plain text while streaming", () => {
    const renderer = streamMarkdownRenderer();
    const parent = document.createElement("div");

    renderer.renderStreamMarkdown(parent, "[[Project Note]]");

    expect(parent.textContent).toBe("[[Project Note]]");
    expect(parent.querySelector("a")).toBeNull();
  });

  it("opens safe vault file links through Obsidian", () => {
    const openLinkText = vi.fn();
    const renderer = streamMarkdownRenderer({ openLinkText, vaultPath: "/Users/showhey/Vault", vaultFiles: ["docs/Guide.md"] });
    const parent = document.createElement("div");

    renderer.renderStreamMarkdown(parent, "[Guide](/Users/showhey/Vault/docs/Guide.md)");
    parent.querySelector<HTMLAnchorElement>("a")?.click();

    expect(openLinkText).toHaveBeenCalledWith("docs/Guide.md", "Inbox.md", false);
  });

  it("does not open absolute file links outside the vault", () => {
    const openLinkText = vi.fn();
    const renderer = streamMarkdownRenderer({ openLinkText, vaultPath: "/Users/showhey/Vault" });
    const parent = document.createElement("div");

    renderer.renderStreamMarkdown(parent, "[Readme](/Users/showhey/Other/README.md)");
    parent.querySelector<HTMLAnchorElement>("a")?.click();

    expect(openLinkText).not.toHaveBeenCalled();
    expect(notices).toEqual(["Cannot open files outside the vault."]);
  });

  it("prevents unresolved vault file links from navigating", () => {
    const openLinkText = vi.fn();
    const renderer = streamMarkdownRenderer({ openLinkText, vaultPath: "/Users/showhey/Vault" });
    const parent = document.createElement("div");

    renderer.renderStreamMarkdown(parent, "[Missing](/Users/showhey/Vault/docs/Missing.md)");
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    parent.querySelector<HTMLAnchorElement>("a")?.dispatchEvent(event);

    expect(openLinkText).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
    expect(notices).toEqual([]);
  });
});

function streamMarkdownRenderer(options: { openLinkText?: ReturnType<typeof vi.fn>; vaultPath?: string; vaultFiles?: string[] } = {}) {
  const files = new Map((options.vaultFiles ?? []).map((path) => [path, tFile(path)]));
  return new StreamMarkdownMessageRenderer({
    app: {
      workspace: {
        getActiveFile: vi.fn(() => tFile("Inbox.md")),
        openLinkText: options.openLinkText ?? vi.fn(),
      },
      vault: {
        configDir: "vault-config",
        getAbstractFileByPath: (path: string) => files.get(path) ?? null,
      },
    } as never,
    vaultPath: options.vaultPath ?? "/vault",
  });
}

function tFile(path: string): TFile {
  const basename = path.split("/").pop()?.replace(/\.md$/, "") ?? path;
  return Object.assign(new TFile(), { path, basename });
}
