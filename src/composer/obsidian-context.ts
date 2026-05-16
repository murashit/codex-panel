import type { App } from "obsidian";
import { TFile } from "obsidian";

import type { NoteCandidate } from "./suggestions";

export interface WikiLinkMention {
  name: string;
  path: string;
}

export function noteCandidates(app: App): NoteCandidate[] {
  return app.vault.getMarkdownFiles().map((file) => ({
    basename: file.basename,
    path: file.path,
    mtime: file.stat.mtime,
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
