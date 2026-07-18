import type { App, EventRef } from "obsidian";
import { stripHeadingForLink, TFile } from "obsidian";

import type { VaultFileReference } from "../../../../domain/chat/input";
import type { NoteCandidateProvider } from "../../application/composer/note-context";
import type { NoteCandidate } from "../../application/composer/suggestions";
import { configuredDailyNoteReferences } from "./vault-daily-note-references.obsidian";
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

interface MetadataCacheWithTags {
  getTags?: () => unknown;
}

interface SharedCandidateCatalog {
  readonly catalog: VaultNoteCandidateCatalog;
  consumers: number;
}

const candidateCatalogs = new WeakMap<App, SharedCandidateCatalog>();

export class VaultNoteCandidateProvider implements NoteCandidateProvider {
  private readonly shared: SharedCandidateCatalog;
  private disposed = false;

  constructor(private readonly app: App) {
    const existing = candidateCatalogs.get(app);
    if (existing) {
      existing.consumers += 1;
      this.shared = existing;
      return;
    }
    this.shared = { catalog: new VaultNoteCandidateCatalog(app), consumers: 1 };
    candidateCatalogs.set(app, this.shared);
  }

  candidates(sourcePath: string): readonly NoteCandidate[] {
    return this.shared.catalog.candidates(sourcePath);
  }

  dailyNoteReferences(sourcePath: string): ReturnType<NoteCandidateProvider["dailyNoteReferences"]> {
    return configuredDailyNoteReferences(this.app, sourcePath);
  }

  tags(): readonly string[] {
    return this.shared.catalog.tags();
  }

  resolveFileReference(target: string, sourcePath: string): VaultFileReference | null {
    return this.shared.catalog.resolveFileReference(target, sourcePath);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.shared.consumers -= 1;
    if (this.shared.consumers > 0) return;
    this.shared.catalog.dispose();
    candidateCatalogs.delete(this.app);
  }
}

class VaultNoteCandidateCatalog {
  private readonly unregisterEvents: (() => void)[] = [];
  private fileCandidatesCache: FileCandidate[] | null = null;
  private tagCandidatesCache: string[] | null = null;
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
    this.registerEvent(app.workspace, app.workspace.on("file-open", invalidate));
    this.registerEvent(app.workspace, app.workspace.on("active-leaf-change", invalidate));
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

  tags(): readonly string[] {
    this.tagCandidatesCache ??= this.readTags();
    return this.tagCandidatesCache;
  }

  private readTags(): string[] {
    return normalizedTags(metadataCacheTags(this.app.metadataCache));
  }

  resolveFileReference(target: string, sourcePath: string): VaultFileReference | null {
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
    this.tagCandidatesCache = null;
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

function metadataCacheTags(metadataCache: App["metadataCache"]): string[] {
  const tagIndex = (metadataCache as MetadataCacheWithTags).getTags?.();
  if (!tagIndex) return [];
  if (Array.isArray(tagIndex)) return tagIndex.filter((tag): tag is string => typeof tag === "string");
  if (typeof tagIndex !== "object") return [];
  return Object.keys(tagIndex);
}

function normalizedTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalizedTags: string[] = [];
  for (const tag of tags) {
    const normalized = tag.trim().replace(/^#+/, "");
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    normalizedTags.push(normalized);
  }
  return normalizedTags.sort((a, b) => a.localeCompare(b));
}

function noteHeadings(app: App, file: TFile): NoteCandidate["headings"] {
  return (app.metadataCache.getFileCache(file)?.headings ?? []).map((heading) => ({
    heading: heading.heading,
    linkHeading: stripHeadingForLink(heading.heading),
    level: heading.level,
  }));
}
