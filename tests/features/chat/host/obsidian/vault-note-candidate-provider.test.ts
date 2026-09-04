// @vitest-environment jsdom

import { type App, type EventRef, TFile } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dailyNotesInterface = vi.hoisted(() => ({
  appHasDailyNotesPluginLoaded: vi.fn<() => boolean>(),
  getDailyNoteSettings: vi.fn(),
}));
const selectionEmphasisMock = vi.hoisted(() => ({
  release: vi.fn(),
  retain: vi.fn(),
  setVisible: vi.fn(),
}));

vi.mock("obsidian-daily-notes-interface", () => dailyNotesInterface);
vi.mock("../../../../../src/shared/obsidian/editor-selection-emphasis.obsidian", () => ({
  retainEditorSelectionEmphasis: selectionEmphasisMock.retain,
}));

import { VaultComposerContextReferenceProvider } from "../../../../../src/features/chat/host/obsidian/vault-composer-context-reference-provider.obsidian";
import { configuredDailyNoteReferences } from "../../../../../src/features/chat/host/obsidian/vault-daily-note-references.obsidian";
import { VaultNoteCandidateProvider } from "../../../../../src/features/chat/host/obsidian/vault-note-candidate-provider.obsidian";

describe("VaultNoteCandidateProvider", () => {
  beforeEach(() => {
    dailyNotesInterface.appHasDailyNotesPluginLoaded.mockReset().mockReturnValue(false);
    dailyNotesInterface.getDailyNoteSettings.mockReset().mockReturnValue(undefined);
    selectionEmphasisMock.release.mockReset();
    selectionEmphasisMock.setVisible.mockReset();
    selectionEmphasisMock.retain
      .mockReset()
      .mockReturnValue({ release: selectionEmphasisMock.release, setVisible: selectionEmphasisMock.setVisible });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps optional daily-note integration failures out of composer suggestions", () => {
    dailyNotesInterface.appHasDailyNotesPluginLoaded.mockImplementation(() => {
      throw new Error("Daily Notes API unavailable");
    });

    expect(configuredDailyNoteReferences(appFixture(), "Inbox.md")).toEqual([]);
  });

  it("builds relative references from the configured daily-note folder and format", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 10, 12));
    dailyNotesInterface.appHasDailyNotesPluginLoaded.mockReturnValue(true);
    dailyNotesInterface.getDailyNoteSettings.mockReturnValue({
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

    expect(configuredDailyNoteReferences(app, "Projects/Codex.md")).toEqual([
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
    expect(fileToLinktext).toHaveBeenCalledWith(existingToday, "Projects/Codex.md", true);
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

    expect(provider.candidates("Inbox.md")).toEqual([
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

  it("caches file candidates and reprojects linktext by source path", () => {
    const files = [{ basename: "Alpha", path: "notes/Alpha.md", stat: { mtime: 100 } }];
    const getFiles = vi.fn(() => vaultFiles(files));
    const fileToLinktext = vi.fn((file: TFile, sourcePath: string) => `${sourcePath}:${file.basename}`);
    const app = appFixture({ getFiles, fileToLinktext });
    const provider = new VaultNoteCandidateProvider(app);

    expect(provider.candidates("Daily/Today.md")[0]?.linktext).toBe("Daily/Today.md:Alpha");
    expect(provider.candidates("Projects.md")[0]?.linktext).toBe("Projects.md:Alpha");
    expect(provider.candidates("Daily/Today.md")[0]?.linktext).toBe("Daily/Today.md:Alpha");
    expect(getFiles).toHaveBeenCalledOnce();
    expect(fileToLinktext).toHaveBeenCalledTimes(2);
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

  it("invalidates cached candidates when the vault changes", () => {
    const files = [{ basename: "Alpha", path: "notes/Alpha.md", stat: { mtime: 100 } }];
    const app = appFixture({ files });
    const provider = new VaultNoteCandidateProvider(app);

    expect(provider.candidates("Inbox.md").map((candidate) => candidate.basename)).toEqual(["Alpha"]);

    files.push({ basename: "Beta", path: "notes/Beta.md", stat: { mtime: 200 } });
    app.triggerVaultEvent("create");

    expect(provider.candidates("Inbox.md").map((candidate) => candidate.basename)).toEqual(["Alpha", "Beta"]);
  });

  it("unregisters Obsidian events when disposed", () => {
    const app = appFixture();
    const provider = new VaultNoteCandidateProvider(app);

    expect(app.registeredEventNames("vault")).toContain("create");
    expect(app.registeredEventNames("metadata")).toContain("changed");
    expect(app.registeredEventNames("workspace")).toContain("file-open");
    provider.dispose();

    expect(app.registeredEventNames("vault")).toEqual([]);
    expect(app.registeredEventNames("metadata")).toEqual([]);
    expect(app.registeredEventNames("workspace")).toEqual([]);
  });

  it("shares candidate caches and event subscriptions across panel providers", () => {
    const getFiles = vi.fn(() => vaultFiles([{ basename: "Alpha", path: "Alpha.md", stat: { mtime: 1 } }]));
    const app = appFixture({ getFiles });
    const first = new VaultNoteCandidateProvider(app);
    const second = new VaultNoteCandidateProvider(app);

    first.candidates("Inbox.md");
    second.candidates("Inbox.md");
    first.dispose();

    expect(getFiles).toHaveBeenCalledOnce();
    expect(app.registeredEventNames("vault")).toContain("create");
    expect(app.registeredEventNames("metadata")).toContain("changed");
    expect(app.registeredEventNames("workspace")).toContain("file-open");

    second.dispose();
    expect(app.registeredEventNames("vault")).toEqual([]);
    expect(app.registeredEventNames("metadata")).toEqual([]);
    expect(app.registeredEventNames("workspace")).toEqual([]);
  });

  it("resolves wikilinks through metadata cache before direct path fallback", () => {
    const linked = tFile("notes/Alpha.md", "Alpha");
    const direct = tFile("Alpha.md", "Alpha direct");
    const app = appFixture({
      linkDestination: linked,
      abstractFiles: new Map([["Alpha.md", direct]]),
    });
    const provider = new VaultNoteCandidateProvider(app);

    expect(provider.resolveFileReference("Alpha", "Inbox.md")).toEqual({ name: "Alpha", path: "notes/Alpha.md" });
  });

  it("resolves direct markdown paths when metadata has no match", () => {
    const direct = tFile("notes/Alpha.md", "Alpha");
    const app = appFixture({
      abstractFiles: new Map([["notes/Alpha.md", direct]]),
    });
    const provider = new VaultNoteCandidateProvider(app);

    expect(provider.resolveFileReference("notes/Alpha", "")).toEqual({ name: "Alpha", path: "notes/Alpha.md" });
    expect(provider.resolveFileReference("Missing", "")).toBeNull();
  });

  it("uses the active file only as Obsidian link-resolution context", () => {
    const linked = tFile("notes/Project.md", "Project");
    const getFirstLinkpathDest = vi.fn(() => linked);
    const app = appFixture({
      getFirstLinkpathDest,
    });
    const provider = new VaultNoteCandidateProvider(app);

    expect(provider.resolveFileReference("Project", "Daily/Today.md")).toEqual({ name: "Project", path: "notes/Project.md" });
    expect(getFirstLinkpathDest).toHaveBeenCalledWith("Project", "Daily/Today.md");
  });

  it("resolves non-markdown wikilinks through Obsidian metadata", () => {
    const linked = tFile("Bases/Projects.base", "Projects");
    const getFirstLinkpathDest = vi.fn(() => linked);
    const app = appFixture({
      getFirstLinkpathDest,
    });
    const provider = new VaultNoteCandidateProvider(app);

    expect(provider.resolveFileReference("Bases/Projects.base", "Daily/Today.md")).toEqual({
      name: "Projects",
      path: "Bases/Projects.base",
    });
    expect(getFirstLinkpathDest).toHaveBeenCalledWith("Bases/Projects.base", "Daily/Today.md");
  });

  it("returns active file and selection references from the last markdown view", () => {
    const file = tFile("notes/Alpha.md", "Alpha");
    const app = appFixture({
      activeView: markdownView(file, {
        selection: "selected text",
        from: { line: 2, ch: 4 },
        to: { line: 3, ch: 1 },
      }),
      abstractFiles: new Map([["notes/Alpha.md", file]]),
      linktexts: new Map([["notes/Alpha.md", "Alpha"]]),
    });
    const provider = new VaultComposerContextReferenceProvider(app, () => false);

    expect(provider.contextReferences("Inbox.md")).toEqual({
      activeNote: { name: "Alpha", path: "notes/Alpha.md", linktext: "Alpha" },
      selection: {
        name: "Alpha",
        path: "notes/Alpha.md",
        linktext: "Alpha",
        range: { from: { line: 2, ch: 4 }, to: { line: 3, ch: 1 } },
        text: "selected text",
      },
    });
  });

  it("shows the matching retained selection only while its owning panel is foreground", () => {
    const file = tFile("notes/Alpha.md", "Alpha");
    const view = markdownView(file, {
      selection: "selected text",
      from: { line: 2, ch: 4 },
      to: { line: 3, ch: 1 },
    });
    const app = appFixture({
      activeView: view,
      abstractFiles: new Map([[file.path, file]]),
      linktexts: new Map([[file.path, "Alpha"]]),
    });
    let panelForeground = true;
    const provider = new VaultComposerContextReferenceProvider(app, () => panelForeground);
    const selection = provider.contextReferences("Inbox.md").selection;
    if (!selection) throw new Error("Expected selection context.");

    app.setActiveView(null);
    app.triggerWorkspaceEvent("active-leaf-change");
    const emphasis = provider.retainSelectionEmphasis(selection);

    expect(selectionEmphasisMock.retain).toHaveBeenCalledWith(view.editor, selection.range);
    expect(selectionEmphasisMock.setVisible).toHaveBeenLastCalledWith(true);

    emphasis?.setEnabled(false);
    expect(selectionEmphasisMock.setVisible).toHaveBeenLastCalledWith(false);

    panelForeground = false;
    app.setActiveView(view);
    app.triggerWorkspaceEvent("active-leaf-change");
    expect(selectionEmphasisMock.setVisible).toHaveBeenLastCalledWith(false);
    expect(selectionEmphasisMock.release).not.toHaveBeenCalled();

    panelForeground = true;
    app.setActiveView(null);
    app.triggerWorkspaceEvent("active-leaf-change");
    expect(selectionEmphasisMock.setVisible).toHaveBeenLastCalledWith(false);

    emphasis?.setEnabled(true);
    expect(selectionEmphasisMock.setVisible).toHaveBeenLastCalledWith(true);

    emphasis?.release();
    expect(selectionEmphasisMock.release).toHaveBeenCalledOnce();

    panelForeground = false;
    app.triggerWorkspaceEvent("active-leaf-change");
    expect(selectionEmphasisMock.setVisible).toHaveBeenCalledTimes(5);
  });

  it("retains the originating editor when the same note is active in another view", () => {
    const alpha = tFile("notes/Alpha.md", "Alpha");
    const selection = {
      selection: "selected text",
      from: { line: 2, ch: 4 },
      to: { line: 3, ch: 1 },
    };
    const alphaView = markdownView(alpha, {
      ...selection,
    });
    const otherAlphaView = markdownView(alpha, selection);
    const app = appFixture({
      activeView: alphaView,
      abstractFiles: new Map([[alpha.path, alpha]]),
      linktexts: new Map([[alpha.path, "Alpha"]]),
    });
    const provider = new VaultComposerContextReferenceProvider(app, () => true);
    const reference = provider.contextReferences("Inbox.md").selection;
    if (!reference) throw new Error("Expected selection context.");

    app.setActiveView(otherAlphaView);
    app.triggerWorkspaceEvent("active-leaf-change");
    provider.retainSelectionEmphasis(reference);

    expect(selectionEmphasisMock.retain).toHaveBeenCalledWith(alphaView.editor, reference.range);
  });

  it("rejects selections whose originating view or source range changed", () => {
    const alpha = tFile("notes/Alpha.md", "Alpha");
    const beta = tFile("notes/Beta.md", "Beta");
    const source = {
      selection: "selected text",
      from: { line: 2, ch: 4 },
      to: { line: 3, ch: 1 },
    };
    const view = markdownView(alpha, source);
    const app = appFixture({
      activeView: view,
      abstractFiles: new Map([
        [alpha.path, alpha],
        [beta.path, beta],
      ]),
      linktexts: new Map([[alpha.path, "Alpha"]]),
    });
    const provider = new VaultComposerContextReferenceProvider(app, () => true);
    const changedSourceSelection = provider.contextReferences("Inbox.md").selection;
    if (!changedSourceSelection) throw new Error("Expected selection context.");
    source.selection = "changed text";

    expect(provider.retainSelectionEmphasis(changedSourceSelection)).toBeNull();

    source.selection = "selected text";
    const changedViewSelection = provider.contextReferences("Inbox.md").selection;
    if (!changedViewSelection) throw new Error("Expected selection context.");

    expect(provider.retainSelectionEmphasis({ ...changedViewSelection })).toBeNull();

    view.file = beta;

    expect(provider.retainSelectionEmphasis(changedViewSelection)).toBeNull();
    expect(selectionEmphasisMock.retain).not.toHaveBeenCalled();
  });

  it("routes retained selection visibility independently between panel providers", () => {
    const file = tFile("notes/Alpha.md", "Alpha");
    const view = markdownView(file, {
      selection: "selected text",
      from: { line: 2, ch: 4 },
      to: { line: 3, ch: 1 },
    });
    const app = appFixture({
      activeView: view,
      abstractFiles: new Map([[file.path, file]]),
      linktexts: new Map([[file.path, "Alpha"]]),
    });
    let firstForeground = true;
    let secondForeground = false;
    const first = new VaultComposerContextReferenceProvider(app, () => firstForeground);
    const second = new VaultComposerContextReferenceProvider(app, () => secondForeground);
    const selection = first.contextReferences("Inbox.md").selection;
    if (!selection) throw new Error("Expected selection context.");
    app.setActiveView(null);
    app.triggerWorkspaceEvent("active-leaf-change");

    const firstEmphasis = { release: vi.fn(), setVisible: vi.fn() };
    const secondEmphasis = { release: vi.fn(), setVisible: vi.fn() };
    selectionEmphasisMock.retain.mockReturnValueOnce(firstEmphasis).mockReturnValueOnce(secondEmphasis);
    const retainedFirst = first.retainSelectionEmphasis(selection);
    second.retainSelectionEmphasis(selection);

    expect(firstEmphasis.setVisible).toHaveBeenLastCalledWith(true);
    expect(secondEmphasis.setVisible).toHaveBeenLastCalledWith(false);

    firstForeground = false;
    secondForeground = true;
    app.triggerWorkspaceEvent("active-leaf-change");
    expect(firstEmphasis.setVisible).toHaveBeenLastCalledWith(false);
    expect(secondEmphasis.setVisible).toHaveBeenLastCalledWith(true);

    retainedFirst?.release();
    second.dispose();
    expect(firstEmphasis.release).toHaveBeenCalledOnce();
    expect(secondEmphasis.release).toHaveBeenCalledOnce();
    first.dispose();
  });

  it("shares active-view event tracking across panel context providers", () => {
    const app = appFixture();
    const first = new VaultComposerContextReferenceProvider(app, () => false);
    const second = new VaultComposerContextReferenceProvider(app, () => false);

    first.dispose();
    expect(app.registeredEventNames("workspace")).toContain("file-open");
    expect(app.registeredEventNames("workspace")).toContain("active-leaf-change");

    second.dispose();
    expect(app.registeredEventNames("workspace")).toEqual([]);
  });
});

type AppFixtureEventSource = "vault" | "metadata" | "workspace";

interface AppFixture extends App {
  registeredEventNames(source: AppFixtureEventSource): string[];
  setActiveView(view: unknown): void;
  triggerVaultEvent(name: string): void;
  triggerWorkspaceEvent(name: string): void;
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
    activeFile?: TFile | null;
    activeView?: unknown;
  } = {},
): AppFixture {
  let activeView: unknown = options.activeView ?? null;
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
    setActiveView: (view: unknown) => {
      activeView = view;
    },
    triggerVaultEvent: (name: string) => {
      for (const event of refs.filter((ref) => ref.source === "vault" && ref.name === name)) {
        event.callback();
      }
    },
    triggerWorkspaceEvent: (name: string) => {
      for (const event of refs.filter((ref) => ref.source === "workspace" && ref.name === name)) {
        event.callback();
      }
    },
    workspace: {
      on: on("workspace"),
      offref: offref("workspace"),
      getActiveFile: () => options.activeFile ?? null,
      getActiveViewOfType: () => activeView,
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

function markdownView(
  file: TFile,
  selection: { selection: string; from: { line: number; ch: number }; to: { line: number; ch: number } },
): {
  file: TFile;
  containerEl: HTMLElement;
  editor: {
    getSelection(): string;
    getCursor(kind: "from" | "to"): { line: number; ch: number };
    getRange(from: { line: number; ch: number }, to: { line: number; ch: number }): string;
  };
} {
  return {
    file,
    containerEl: document.createElement("div"),
    editor: {
      getSelection: () => selection.selection,
      getCursor: (kind: "from" | "to") => (kind === "from" ? selection.from : selection.to),
      getRange: (from, to) =>
        from.line === selection.from.line && from.ch === selection.from.ch && to.line === selection.to.line && to.ch === selection.to.ch
          ? selection.selection
          : "",
    },
  };
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
