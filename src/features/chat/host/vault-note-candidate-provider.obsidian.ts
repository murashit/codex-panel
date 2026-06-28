import type { App, EventRef } from "obsidian";
import { stripHeadingForLink, TFile } from "obsidian";

import type { NoteCandidateProvider, WikiLinkMention } from "../application/composer/note-context";
import type { NoteCandidate } from "../application/composer/suggestions";
import { displayNameForFile, linktextForFile } from "./vault-note-links.obsidian";

interface FileCandidate {
  basename: string;
  displayName: string;
  path: string;
  mtime: number;
  file: TFile;
  headings: NoteCandidate["headings"];
}

interface EventSource {
  offref?(ref: EventRef): void;
}

export class VaultNoteCandidateProvider implements NoteCandidateProvider {
  private readonly unregisterEvents: (() => void)[] = [];
  private fileCandidatesCache: FileCandidate[] | null = null;
  private readonly projectedCandidatesBySourcePath = new Map<string, NoteCandidate[]>();

  constructor(private readonly app: App) {
    const invalidate = (): void => {
      this.invalidate();
    };
    this.registerEvent(app.vault, app.vault.on("create", invalidate));
    this.registerEvent(app.vault, app.vault.on("delete", invalidate));
    this.registerEvent(app.vault, app.vault.on("rename", invalidate));
    this.registerEvent(app.vault, app.vault.on("modify", invalidate));
    this.registerEvent(app.metadataCache, app.metadataCache.on("changed", invalidate));
    this.registerEvent(app.metadataCache, app.metadataCache.on("deleted", invalidate));
  }

  candidates(sourcePath: string): readonly NoteCandidate[] {
    const cached = this.projectedCandidatesBySourcePath.get(sourcePath);
    if (cached) return cached;

    const recentPaths = new Map(this.app.workspace.getLastOpenFiles().map((path, index) => [path, index]));
    const candidates = this.fileCandidates().map((candidate) => ({
      basename: candidate.basename,
      displayName: candidate.displayName,
      path: candidate.path,
      mtime: candidate.mtime,
      linktext: linktextForFile(this.app, candidate.file, sourcePath),
      headings: candidate.headings,
      recentIndex: recentPaths.get(candidate.path) ?? null,
    }));
    this.projectedCandidatesBySourcePath.set(sourcePath, candidates);
    return candidates;
  }

  resolveMention(target: string, sourcePath: string): WikiLinkMention | null {
    const linkedFile = this.app.metadataCache.getFirstLinkpathDest(target, sourcePath);
    if (linkedFile?.path) return { name: linkedFile.basename, path: linkedFile.path };

    const directPath = target.endsWith(".md") ? target : `${target}.md`;
    const abstractFile = this.app.vault.getAbstractFileByPath(directPath);
    if (abstractFile instanceof TFile) return { name: abstractFile.basename, path: abstractFile.path };
    return null;
  }

  dispose(): void {
    for (const unregister of this.unregisterEvents.splice(0)) {
      unregister();
    }
    this.invalidate();
  }

  private registerEvent(source: EventSource, ref: EventRef): void {
    this.unregisterEvents.push(() => {
      source.offref?.(ref);
    });
  }

  private invalidate(): void {
    this.fileCandidatesCache = null;
    this.projectedCandidatesBySourcePath.clear();
  }

  private fileCandidates(): FileCandidate[] {
    this.fileCandidatesCache ??= this.app.vault.getFiles().map((file) => ({
      basename: file.basename,
      displayName: displayNameForFile(file),
      path: file.path,
      mtime: file.stat.mtime,
      file,
      headings: noteHeadings(this.app, file),
    }));
    return this.fileCandidatesCache;
  }
}

function noteHeadings(app: App, file: TFile): NoteCandidate["headings"] {
  return (app.metadataCache.getFileCache(file)?.headings ?? []).map((heading) => ({
    heading: heading.heading,
    linkHeading: stripHeadingForLink(heading.heading),
    level: heading.level,
  }));
}
