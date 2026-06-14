import { describe, expect, it, vi } from "vitest";
import { TFile, type App } from "obsidian";

import { noteCandidates, resolveWikiLinkMention } from "../../../../src/features/chat/panel/composer-obsidian-context";

describe("Obsidian composer context", () => {
  it("builds note candidates from markdown files", () => {
    const app = appFixture({
      files: [
        { basename: "Alpha", path: "notes/Alpha.md", stat: { mtime: 100 } },
        { basename: "Beta", path: "Beta.md", stat: { mtime: 200 } },
        { basename: "Daily", path: "Personal/Daily Notes/Daily.md", stat: { mtime: 300 } },
        { basename: "Projects", path: "Bases/Projects.base", stat: { mtime: 400 } },
        { basename: "Paper", path: "References/Paper.pdf", stat: { mtime: 500 } },
        { basename: "Diagram", path: "Assets/Diagram.png", stat: { mtime: 600 } },
        { basename: "LICENSE", path: "Attachments/LICENSE", stat: { mtime: 700 } },
      ],
      lastOpenFiles: ["Beta.md"],
      linktexts: new Map([
        ["notes/Alpha.md", "Alpha"],
        ["Personal/Daily Notes/Daily.md", "Personal/Daily Notes/Daily"],
        ["Bases/Projects.base", "Bases/Projects"],
        ["References/Paper.pdf", "References/Paper"],
        ["Assets/Diagram.png", "Assets/Diagram.png"],
        ["Attachments/LICENSE", "Attachments/LICENSE"],
      ]),
      headings: new Map([["Beta.md", [{ heading: "Overview", level: 1 }]]]),
    });

    expect(noteCandidates(app)).toEqual([
      { basename: "Alpha", displayName: "Alpha", path: "notes/Alpha.md", mtime: 100, linktext: "Alpha", headings: [], recentIndex: null },
      {
        basename: "Beta",
        displayName: "Beta",
        path: "Beta.md",
        mtime: 200,
        linktext: "Beta",
        headings: [{ heading: "Overview", linkHeading: "Overview", level: 1 }],
        recentIndex: 0,
      },
      {
        basename: "Daily",
        displayName: "Daily",
        path: "Personal/Daily Notes/Daily.md",
        mtime: 300,
        linktext: "Personal/Daily Notes/Daily",
        headings: [],
        recentIndex: null,
      },
      {
        basename: "Projects",
        displayName: "Projects.base",
        path: "Bases/Projects.base",
        mtime: 400,
        linktext: "Bases/Projects.base",
        headings: [],
        recentIndex: null,
      },
      {
        basename: "Paper",
        displayName: "Paper.pdf",
        path: "References/Paper.pdf",
        mtime: 500,
        linktext: "References/Paper.pdf",
        headings: [],
        recentIndex: null,
      },
      {
        basename: "Diagram",
        displayName: "Diagram.png",
        path: "Assets/Diagram.png",
        mtime: 600,
        linktext: "Assets/Diagram.png",
        headings: [],
        recentIndex: null,
      },
      {
        basename: "LICENSE",
        displayName: "LICENSE",
        path: "Attachments/LICENSE",
        mtime: 700,
        linktext: "Attachments/LICENSE",
        headings: [],
        recentIndex: null,
      },
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

  it("resolves non-markdown wikilinks through Obsidian metadata", () => {
    const linked = tFile("Bases/Projects.base", "Projects");
    const getFirstLinkpathDest = vi.fn(() => linked);
    const app = appFixture({
      activePath: "Daily/Today.md",
      getFirstLinkpathDest,
    });

    expect(resolveWikiLinkMention(app, "Bases/Projects.base")).toEqual({ name: "Projects", path: "Bases/Projects.base" });
    expect(getFirstLinkpathDest).toHaveBeenCalledWith("Bases/Projects.base", "Daily/Today.md");
  });
});

function appFixture(options: {
  activePath?: string;
  linkDestination?: TFile | null;
  getFirstLinkpathDest?: (target: string, sourcePath: string) => TFile | null;
  lastOpenFiles?: string[];
  files?: { basename: string; path: string; stat: { mtime: number } }[];
  abstractFiles?: Map<string, TFile>;
  linktexts?: Map<string, string>;
  headings?: Map<string, { heading: string; level: number }[]>;
}): App {
  return {
    workspace: {
      getActiveFile: () => (options.activePath ? { path: options.activePath } : null),
      getLastOpenFiles: () => options.lastOpenFiles ?? [],
    },
    metadataCache: {
      getFirstLinkpathDest: options.getFirstLinkpathDest ?? (() => options.linkDestination ?? null),
      fileToLinktext: (file: TFile, _sourcePath: string, omitMdExtension?: boolean) =>
        options.linktexts?.get(file.path) ?? (omitMdExtension === true ? file.path.replace(/\.md$/i, "") : file.path),
      getFileCache: (file: TFile) => ({ headings: options.headings?.get(file.path) ?? [] }),
    },
    vault: {
      getFiles: () => vaultFiles(options.files ?? []),
      getMarkdownFiles: () => vaultFiles(options.files ?? []).filter((file) => file.path.toLowerCase().endsWith(".md")),
      getAbstractFileByPath: (path: string) => options.abstractFiles?.get(path) ?? null,
    },
  } as unknown as App;
}

function tFile(path: string, basename: string): TFile {
  const name = path.split("/").pop() ?? path;
  const extensionStart = name.lastIndexOf(".");
  const extension = extensionStart === -1 ? "" : name.slice(extensionStart + 1);
  return Object.assign(new TFile(), { path, basename, extension, name });
}

function vaultFiles(files: { basename: string; path: string; stat: { mtime: number } }[]): TFile[] {
  return files.map((file) => Object.assign(tFile(file.path, file.basename), { stat: file.stat }));
}
