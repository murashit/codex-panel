import { describe, expect, it, vi } from "vitest";

import {
  saveWebClipMarkdown,
  type WebClipDestination,
  webClipMarkdown,
} from "../../../../../src/features/chat/application/web-clipping/web-clip";

describe("web clipping", () => {
  it("writes clipped markdown with fixed frontmatter and tags", () => {
    const output = webClipMarkdown(
      {
        url: "https://example.com/post",
        title: "Example Post",
        content: "Body",
      },
      { clipTags: '#web, "clipping", web, {{title}}' },
      "Example Post",
      new Date("2026-07-05T03:04:05.000Z"),
    );

    expect(output).toBe(
      [
        "---",
        'title: "Example Post"',
        'url: "https://example.com/post"',
        'created: "2026-07-05T03:04:05.000Z"',
        'tags: ["web", "clipping", "{{title}}"]',
        "---",
        "",
        "# Example Post",
        "",
        "Body",
        "",
      ].join("\n"),
    );
  });

  it("saves clips under a unique path from the filename template", async () => {
    const destination = memoryDestination(["Codex Clippings/Example Site - Example-Post.md"]);

    const result = await saveWebClipMarkdown(
      {
        url: "https://example.com/post",
        title: "Example/Post",
        site: "Example Site",
        domain: "example.com",
        content: "Body",
      },
      {
        clipFolder: "Codex Clippings",
        clipFilenameTemplate: "{{site}} - {{title}}",
        clipTags: "",
      },
      destination,
      new Date("2026-07-05T03:04:05.000Z"),
    );

    expect(result).toEqual({
      path: "Codex Clippings/Example Site - Example-Post 2.md",
      wikilink: "[[Codex Clippings/Example Site - Example-Post 2.md]]",
    });
    expect(destination.createFolder).toHaveBeenCalledWith("Codex Clippings");
    expect(destination.createMarkdownFile).toHaveBeenCalledWith("Codex Clippings/Example Site - Example-Post 2.md", expect.any(String));
  });

  it("rejects absolute and relative clip folders", async () => {
    const destination = memoryDestination([]);

    await expect(
      saveWebClipMarkdown(
        { url: "https://example.com", title: "Example", content: "Body" },
        { clipFolder: "../outside", clipFilenameTemplate: "{{title}}.md" },
        destination,
      ),
    ).rejects.toThrow("Clip folder cannot contain relative path segments.");
  });
});

function memoryDestination(existingPaths: readonly string[]): WebClipDestination & {
  createFolder: ReturnType<typeof vi.fn<WebClipDestination["createFolder"]>>;
  createMarkdownFile: ReturnType<typeof vi.fn<WebClipDestination["createMarkdownFile"]>>;
} {
  const paths = new Set(existingPaths);
  return {
    normalizePath: (path) => path.replace(/[\\/]+/g, "/").replace(/^\/+|\/+$/g, ""),
    exists: vi.fn(async (path) => paths.has(path)),
    createFolder: vi.fn<WebClipDestination["createFolder"]>().mockResolvedValue(undefined),
    createMarkdownFile: vi.fn<WebClipDestination["createMarkdownFile"]>().mockImplementation(async (path) => {
      paths.add(path);
    }),
  };
}
