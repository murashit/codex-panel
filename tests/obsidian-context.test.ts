import { describe, expect, it } from "vitest";
import { TFile, type App } from "obsidian";

import { noteCandidates, resolveWikiLinkMention } from "../src/composer/obsidian-context";

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
});

function appFixture(options: {
  activePath?: string;
  linkDestination?: TFile | null;
  markdownFiles?: Array<{ basename: string; path: string; stat: { mtime: number } }>;
  abstractFiles?: Map<string, TFile>;
}): App {
  return {
    workspace: {
      getActiveFile: () => (options.activePath ? { path: options.activePath } : null),
    },
    metadataCache: {
      getFirstLinkpathDest: () => options.linkDestination ?? null,
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
