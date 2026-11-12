// @vitest-environment jsdom

import { type App, type EventRef, TFile } from "obsidian";
import * as dailyNotesInterface from "obsidian-daily-notes-interface";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { configuredDailyNoteReferences } from "../../../../../src/features/chat/host/obsidian/vault-daily-note-references.obsidian";
import { VaultNoteCandidateProvider } from "../../../../../src/features/chat/host/obsidian/vault-note-candidate-provider.obsidian";
import { TExternalFile } from "../../../../mocks/obsidian";

describe("VaultNoteCandidateProvider", () => {
  beforeEach(() => {
    vi.spyOn(dailyNotesInterface, "appHasDailyNotesPluginLoaded").mockReturnValue(false);
    vi.spyOn(dailyNotesInterface, "getDailyNoteSettings").mockReturnValue({ format: "", folder: "", template: "" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("keeps optional daily-note integration failures out of composer suggestions", () => {
    vi.mocked(dailyNotesInterface.appHasDailyNotesPluginLoaded).mockImplementation(() => {
      throw new Error("Daily Notes API unavailable");
    });

    expect(configuredDailyNoteReferences(appFixture())).toEqual([]);
  });

  it("builds relative references from the configured daily-note folder and format", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 10, 12));
    vi.mocked(dailyNotesInterface.appHasDailyNotesPluginLoaded).mockReturnValue(true);
    vi.mocked(dailyNotesInterface.getDailyNoteSettings).mockReturnValue({
      folder: "Journal",
      format: "YYYY/MM/YYYY-MM-DD",
      template: "",
    });
    const existingToday = tFile("Journal/2026/07/2026-07-10.md", "2026-07-10");
    const fileToLinktext = vi.fn((file: TFile) => (file === existingToday ? "2026-07-10" : file.path));
    const app = appFixture({
      abstractFiles: new Map([[existingToday.path, existingToday]]),
      fileToLinktext,
    });

    const provider = new VaultNoteCandidateProvider(app);
    onTestFinished(() => provider.dispose());
    expect(provider.dailyNoteReferences()).toEqual([
      {
        keyword: "today",
        display: "Today",
        name: "2026-07-10",
        path: "Journal/2026/07/2026-07-10.md",
        linktext: "2026-07-10",
      },
      {
        keyword: "tomorrow",
        display: "Tomorrow",
        name: "2026-07-11",
        path: "Journal/2026/07/2026-07-11.md",
        linktext: "Journal/2026/07/2026-07-11",
      },
      {
        keyword: "yesterday",
        display: "Yesterday",
        name: "2026-07-09",
        path: "Journal/2026/07/2026-07-09.md",
        linktext: "Journal/2026/07/2026-07-09",
      },
    ]);
    expect(fileToLinktext).toHaveBeenCalledWith(existingToday, "", true);
  });

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
    const provider = new VaultNoteCandidateProvider(app);

    expect(provider.candidates()).toEqual([
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

  it("caches file candidates with an empty source path", () => {
    const getFiles = vi.fn(() => vaultFiles([{ basename: "Alpha", path: "notes/Alpha.md", stat: { mtime: 100 } }]));
    const fileToLinktext = vi.fn((file: TFile, sourcePath: string) => `${sourcePath}:${file.basename}`);
    const provider = new VaultNoteCandidateProvider(appFixture({ getFiles, fileToLinktext }));
    expect(provider.candidates()[0]?.linktext).toBe(":Alpha");
    expect(provider.candidates()[0]?.linktext).toBe(":Alpha");
    expect(getFiles).toHaveBeenCalledOnce();
    expect(fileToLinktext).toHaveBeenCalledOnce();
  });

  it("returns normalized Obsidian tag candidates from file metadata", () => {
    const app = appFixture({
      files: [
        { basename: "Alpha", path: "Alpha.md", stat: { mtime: 1 } },
        { basename: "Beta", path: "Beta.md", stat: { mtime: 2 } },
      ],
      tags: new Map([
        ["Alpha.md", { inline: ["#project/codex", "#daily"], frontmatter: ["web"] }],
        ["Beta.md", ["#DAILY"]],
      ]),
    });
    const provider = new VaultNoteCandidateProvider(app);

    expect(provider.tags()).toEqual(["daily", "project/codex", "web"]);
  });

  it("shares candidate caches and event subscriptions across panel providers", () => {
    let files = vaultFiles([{ basename: "Alpha", path: "Alpha.md", stat: { mtime: 1 } }]);
    const getFiles = vi.fn(() => files);
    const app = appFixture({ getFiles });
    const first = new VaultNoteCandidateProvider(app);
    const second = new VaultNoteCandidateProvider(app);

    first.candidates();
    second.candidates();
    first.dispose();

    expect(getFiles).toHaveBeenCalledOnce();
    expect(app.registeredEventNames("vault")).toContain("create");
    expect(app.registeredEventNames("metadata")).toContain("changed");
    expect(app.registeredEventNames("workspace")).toContain("file-open");

    second.dispose();
    expect(app.registeredEventNames("vault")).toEqual([]);
    expect(app.registeredEventNames("metadata")).toEqual([]);
    expect(app.registeredEventNames("workspace")).toEqual([]);

    const reopened = new VaultNoteCandidateProvider(app);
    onTestFinished(() => reopened.dispose());
    expect(reopened.candidates().map((candidate) => candidate.path)).toEqual(["Alpha.md"]);
    files = vaultFiles([
      { basename: "Alpha", path: "Alpha.md", stat: { mtime: 1 } },
      { basename: "Beta", path: "Beta.md", stat: { mtime: 2 } },
    ]);
    app.triggerVaultEvent("create");
    expect(reopened.candidates().map((candidate) => candidate.path)).toEqual(["Alpha.md", "Beta.md"]);
  });

  it("resolves wikilinks through metadata cache", () => {
    const linked = tFile("notes/Alpha.md", "Alpha");
    const direct = tFile("Alpha.md", "Alpha direct");
    const getFirstLinkpathDest = vi.fn(() => linked);
    const app = appFixture({
      getFirstLinkpathDest,
      abstractFiles: new Map([["Alpha.md", direct]]),
    });
    const provider = new VaultNoteCandidateProvider(app);

    expect(provider.resolveFileReference("Alpha")).toEqual({ name: "Alpha", path: "notes/Alpha.md" });
    expect(getFirstLinkpathDest).toHaveBeenCalledWith("Alpha", "");
  });

  it("sends real paths for externally resolved wikilinks", () => {
    const external = new TExternalFile("file:/outside/Target.md") as unknown as TFile;
    const app = appFixture({
      getFirstLinkpathDest: (target) => (target === "Target" ? external : null),
      abstractFiles: new Map([[external.path, external]]),
    });
    const provider = new VaultNoteCandidateProvider(app);
    onTestFinished(() => provider.dispose());
    expect(provider.resolveFileReference("Target")).toEqual({ name: "Target", path: "/outside/Target.md" });
    expect(provider.resolveFileReference("/outside/Target.md")).toBeNull();
    expect(provider.resolveFileReference("file:///outside/Target.md")).toBeNull();
  });

  it("resolves non-markdown wikilinks through Obsidian metadata", () => {
    const linked = tFile("Bases/Projects.base", "Projects");
    const getFirstLinkpathDest = vi.fn(() => linked);
    const app = appFixture({
      getFirstLinkpathDest,
    });
    const provider = new VaultNoteCandidateProvider(app);

    expect(provider.resolveFileReference("Bases/Projects.base")).toEqual({
      name: "Projects",
      path: "Bases/Projects.base",
    });
    expect(getFirstLinkpathDest).toHaveBeenCalledWith("Bases/Projects.base", "");
  });
});

type AppFixtureEventSource = "vault" | "metadata" | "workspace";

interface AppFixture extends App {
  registeredEventNames(source: AppFixtureEventSource): string[];
  triggerVaultEvent(name: string): void;
}

function appFixture(
  options: {
    linkDestination?: TFile | null;
    getFirstLinkpathDest?: (target: string, sourcePath: string) => TFile | null;
    lastOpenFiles?: string[];
    files?: { basename: string; path: string; stat: { mtime: number } }[];
    getFiles?: () => TFile[];
    abstractFiles?: Map<string, TFile>;
    linktexts?: Map<string, string>;
    fileToLinktext?: (file: TFile, sourcePath: string, omitMdExtension?: boolean) => string;
    headings?: Map<string, { heading: string; level: number }[]>;
    tags?: Map<string, string[] | { inline?: string[]; frontmatter?: string[] }>;
  } = {},
): AppFixture {
  const refs: { source: AppFixtureEventSource; name: string; callback: () => void; ref: EventRef }[] = [];
  const offref =
    (source: AppFixtureEventSource) =>
    (ref: EventRef): void => {
      const index = refs.findIndex((event) => event.source === source && event.ref === ref);
      if (index !== -1) refs.splice(index, 1);
    };
  const on =
    (source: AppFixtureEventSource) =>
    (name: string, callback: () => void): EventRef => {
      const ref = {
        id: `${source}:${name}:${refs.length.toString()}`,
        __obsidianMockCleanup: () => offref(source)(ref as unknown as EventRef),
      } as unknown as EventRef;
      refs.push({ source, name, callback, ref });
      return ref;
    };
  return {
    registeredEventNames: (source: AppFixtureEventSource) => refs.filter((event) => event.source === source).map((event) => event.name),
    triggerVaultEvent: (name: string) => {
      for (const event of refs.filter((ref) => ref.source === "vault" && ref.name === name)) {
        event.callback();
      }
    },
    workspace: {
      on: on("workspace"),
      offref: offref("workspace"),
      getLastOpenFiles: () => options.lastOpenFiles ?? [],
    },
    metadataCache: {
      on: on("metadata"),
      offref: offref("metadata"),
      getFirstLinkpathDest: options.getFirstLinkpathDest ?? (() => options.linkDestination ?? null),
      fileToLinktext:
        options.fileToLinktext ??
        ((file: TFile, _sourcePath: string, omitMdExtension?: boolean) =>
          options.linktexts?.get(file.path) ?? (omitMdExtension === true ? file.path.replace(/\.md$/i, "") : file.path)),
      getFileCache: (file: TFile) => ({
        headings: options.headings?.get(file.path) ?? [],
        tags: tagFixtureForPath(options.tags, file.path).inline.map((tag) => ({ tag })),
        frontmatter: { tags: tagFixtureForPath(options.tags, file.path).frontmatter },
      }),
    },
    vault: {
      on: on("vault"),
      offref: offref("vault"),
      getFiles: options.getFiles ?? (() => vaultFiles(options.files ?? [])),
      getAbstractFileByPath: (path: string) => options.abstractFiles?.get(path) ?? null,
    },
  } as unknown as AppFixture;
}

function tFile(path: string, basename: string): TFile {
  const name = path.split("/").pop() ?? path;
  const extensionStart = name.lastIndexOf(".");
  const extension = extensionStart === -1 ? "" : name.slice(extensionStart + 1);
  return Object.assign(new TFile(), { path, basename, extension, name });
}

function tagFixtureForPath(
  tags: Map<string, string[] | { inline?: string[]; frontmatter?: string[] }> | undefined,
  path: string,
): { inline: string[]; frontmatter: string[] } {
  const value = tags?.get(path);
  if (!value) return { inline: [], frontmatter: [] };
  return Array.isArray(value) ? { inline: value, frontmatter: [] } : { inline: value.inline ?? [], frontmatter: value.frontmatter ?? [] };
}

function vaultFiles(files: { basename: string; path: string; stat: { mtime: number } }[]): TFile[] {
  return files.map((file) => Object.assign(tFile(file.path, file.basename), { stat: file.stat }));
}
