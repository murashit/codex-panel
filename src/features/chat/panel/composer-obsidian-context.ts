import type { App } from "obsidian";
import { stripHeadingForLink, TFile } from "obsidian";

import type { NoteCandidate } from "../application/composer/suggestions";

export interface WikiLinkMention {
  name: string;
  path: string;
}

export function noteCandidates(app: App): NoteCandidate[] {
  const sourcePath = app.workspace.getActiveFile()?.path ?? "";
  const recentPaths = new Map(app.workspace.getLastOpenFiles().map((path, index) => [path, index]));
  return app.vault.getFiles().map((file) => ({
    basename: file.basename,
    displayName: displayNameForFile(file),
    path: file.path,
    mtime: file.stat.mtime,
    linktext: linktextForFile(app, file, sourcePath),
    headings: noteHeadings(app, file),
    recentIndex: recentPaths.get(file.path) ?? null,
  }));
}

export function resolveWikiLinkMention(app: App, target: string): WikiLinkMention | null {
  const sourcePath = app.workspace.getActiveFile()?.path ?? "";
  const linkedFile = app.metadataCache.getFirstLinkpathDest(target, sourcePath);
  if (linkedFile?.path) return { name: linkedFile.basename, path: linkedFile.path };

  const directPath = target.endsWith(".md") ? target : `${target}.md`;
  const abstractFile = app.vault.getAbstractFileByPath(directPath);
  if (abstractFile instanceof TFile) return { name: abstractFile.basename, path: abstractFile.path };
  return null;
}

function linktextForFile(app: App, file: TFile, sourcePath: string): string {
  const linktext = app.metadataCache.fileToLinktext(file, sourcePath, true);
  const extension = file.extension.toLowerCase();
  return extension === "md" || extension.length === 0 || linktext.toLowerCase().endsWith(`.${extension}`)
    ? linktext
    : `${linktext}.${file.extension}`;
}

function displayNameForFile(file: TFile): string {
  return file.extension === "md" ? file.basename : file.name;
}

function noteHeadings(app: App, file: TFile): NoteCandidate["headings"] {
  return (app.metadataCache.getFileCache(file)?.headings ?? []).map((heading) => ({
    heading: heading.heading,
    linkHeading: stripHeadingForLink(heading.heading),
    level: heading.level,
  }));
}
