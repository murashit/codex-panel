import { describe, expect, it, vi } from "vitest";
import { TFile, type App } from "obsidian";

import { noteCandidates, resolveWikiLinkMention } from "../../src/features/chat/composer/obsidian-context";

describe("Obsidian composer context", () => {
  it("builds note candidates from markdown files", () => {
    const app = appFixture({
      markdownFiles: [
        { basename: "Alpha", path: "notes/Alpha.md", stat: { mtime: 100 } },
        { basename: "Beta", path: "Beta.md", stat: { mtime: 200 } },
      ],
    });

    expect(noteCandidates(app)).toEqual([
      { basename: "Alpha", path: "notes/Alpha.md", mtime: 100 },
      { basename: "Beta", path: "Beta.md", mtime: 200 },
    ]);
  });

  it("resolves wikilinks through metadata cache before direct path fallback", () => {
    const linked = tFile("notes/Alpha.md", "Alpha");
    const direct = tFile("Alpha.md", "Alpha direct");
    const app = appFixture({
      activePath: "Inbox.md",
      linkDestination: linked,
      abstractFiles: new Map([["Alpha.md", direct]]),
    });

    expect(resolveWikiLinkMention(app, "Alpha")).toEqual({ name: "Alpha", path: "notes/Alpha.md" });
  });

  it("resolves direct markdown paths when metadata has no match", () => {
    const direct = tFile("notes/Alpha.md", "Alpha");
    const app = appFixture({
      abstractFiles: new Map([["notes/Alpha.md", direct]]),
    });

    expect(resolveWikiLinkMention(app, "notes/Alpha")).toEqual({ name: "Alpha", path: "notes/Alpha.md" });
    expect(resolveWikiLinkMention(app, "Missing")).toBeNull();
  });

  it("uses the active note only as Obsidian link-resolution context", () => {
    const linked = tFile("notes/Project.md", "Project");
    const getFirstLinkpathDest = vi.fn(() => linked);
    const app = appFixture({
      activePath: "Daily/Today.md",
      getFirstLinkpathDest,
    });

    expect(resolveWikiLinkMention(app, "Project")).toEqual({ name: "Project", path: "notes/Project.md" });
    expect(getFirstLinkpathDest).toHaveBeenCalledWith("Project", "Daily/Today.md");
  });
});

function appFixture(options: {
  activePath?: string;
  linkDestination?: TFile | null;
  getFirstLinkpathDest?: (target: string, sourcePath: string) => TFile | null;
  markdownFiles?: { basename: string; path: string; stat: { mtime: number } }[];
  abstractFiles?: Map<string, TFile>;
}): App {
  return {
    workspace: {
      getActiveFile: () => (options.activePath ? { path: options.activePath } : null),
    },
    metadataCache: {
      getFirstLinkpathDest: options.getFirstLinkpathDest ?? (() => options.linkDestination ?? null),
    },
    vault: {
      getMarkdownFiles: () => options.markdownFiles ?? [],
      getAbstractFileByPath: (path: string) => options.abstractFiles?.get(path) ?? null,
    },
  } as unknown as App;
}

function tFile(path: string, basename: string): TFile {
  return Object.assign(new TFile(), { path, basename });
}
