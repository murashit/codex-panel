import type { App, TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { resolveObsidianWikilinks } from "../../../../../src/features/chat/host/obsidian/wikilink-resolution.obsidian";
import { TExternalFile } from "../../../../mocks/obsidian";

describe("Obsidian wikilink resolution", () => {
  it("resolves aliases and subpaths relative to the supplied source note", () => {
    const destination = { path: "Projects/Target.md" } as TFile;
    const getFirstLinkpathDest = vi.fn((linkpath: string) => (linkpath === "Missing" ? null : destination));
    const app = appWithResolver(getFirstLinkpathDest);

    const result = resolveObsidianWikilinks(app, {
      sourcePath: "Daily/Today.md",
      wikilinks: ["[[../Projects/Target#Milestone|project status]]", "[[Missing#^block]]"],
    });

    expect(getFirstLinkpathDest).toHaveBeenNthCalledWith(1, "../Projects/Target", "Daily/Today.md");
    expect(getFirstLinkpathDest).toHaveBeenNthCalledWith(2, "Missing", "Daily/Today.md");
    expect(result).toEqual({
      schemaVersion: 1,
      sourcePath: "Daily/Today.md",
      untrustedDataNotice: expect.stringContaining("untrusted"),
      results: [
        {
          query: "[[../Projects/Target#Milestone|project status]]",
          status: "resolved",
          linkpath: "../Projects/Target",
          subpath: "#Milestone",
          displayText: "project status",
          resolvedPath: "Projects/Target.md",
        },
        {
          query: "[[Missing#^block]]",
          status: "unresolved",
          linkpath: "Missing",
          subpath: "#^block",
          displayText: null,
          resolvedPath: null,
        },
      ],
    });
  });

  it("resolves relative links from an external note and returns real paths", () => {
    const destination = new TExternalFile("file:/outside/Target.md") as unknown as TFile;
    const resolver = vi.fn(() => destination);
    const result = resolveObsidianWikilinks(appWithResolver(resolver), { sourcePath: "/outside/Source.md", wikilinks: ["[[Target]]"] });
    expect(resolver).toHaveBeenCalledWith("Target", "file:/outside/Source.md");
    expect(result.results[0]?.resolvedPath).toBe("/outside/Target.md");
    expect(result.sourcePath).toBe("/outside/Source.md");
  });

  it("leaves absolute wikilinks unresolved when Obsidian cannot resolve them", () => {
    const destination = new TExternalFile("file:/outside/Target.md") as unknown as TFile;
    const app = {
      metadataCache: { getFirstLinkpathDest: () => null },
      vault: { getAbstractFileByPath: (path: string) => (path === destination.path ? destination : null) },
    } as unknown as App;
    const result = resolveObsidianWikilinks(app, { wikilinks: ["[[/outside/Target.md]]", "[[file:///outside/Target.md]]"] });
    expect(result.results.map((item) => item.resolvedPath)).toEqual([null, null]);
  });

  it("resolves without note context when sourcePath is omitted", () => {
    const getFirstLinkpathDest = vi.fn(() => null);

    const result = resolveObsidianWikilinks(appWithResolver(getFirstLinkpathDest), {
      wikilinks: ["[[Unique Note]]"],
    });

    expect(getFirstLinkpathDest).toHaveBeenCalledWith("Unique Note", "");
    expect(result.sourcePath).toBeNull();
  });

  it.each([
    { name: "non-object input", input: null, message: "must be an object" },
    { name: "empty source path", input: { sourcePath: " ", wikilinks: ["[[Note]]"] }, message: "sourcePath" },
    { name: "empty batch", input: { sourcePath: "Source.md", wikilinks: [] }, message: "between 1 and 16" },
    { name: "embed", input: { sourcePath: "Source.md", wikilinks: ["![[Note]]"] }, message: "Embeds are not supported" },
    { name: "markdown link", input: { sourcePath: "Source.md", wikilinks: ["[Note](Note.md)"] }, message: "Invalid raw wikilink" },
    { name: "empty target", input: { sourcePath: "Source.md", wikilinks: ["[[#Heading]]"] }, message: "file target" },
  ])("rejects $name", ({ input, message }) => {
    expect(() =>
      resolveObsidianWikilinks(
        appWithResolver(() => null),
        input,
      ),
    ).toThrow(message);
  });
});

function appWithResolver(getFirstLinkpathDest: (linkpath: string, sourcePath: string) => TFile | null): App {
  return { metadataCache: { getFirstLinkpathDest } } as unknown as App;
}
