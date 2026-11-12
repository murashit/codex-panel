import type { App } from "obsidian";
import { Component, getAllTags, stripHeadingForLink, type TFile } from "obsidian";
import type { VaultFileReference } from "../../../../domain/input/input";
import { normalizedUniqueTags } from "../../../../domain/notes/tags";
import { fileReferencePath } from "../../../../shared/obsidian/file-path.obsidian";
import type { NoteCandidate, NoteCandidateProvider } from "../../application/composer/note-context";
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

  candidates(): readonly NoteCandidate[] {
    return this.shared.catalog.candidates();
  }

  dailyNoteReferences(): ReturnType<NoteCandidateProvider["dailyNoteReferences"]> {
    return configuredDailyNoteReferences(this.app);
  }

  tags(): readonly string[] {
    return this.shared.catalog.tags();
  }

  resolveFileReference(target: string): VaultFileReference | null {
    return this.shared.catalog.resolveFileReference(target);
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

class VaultNoteCandidateCatalog extends Component {
  private fileCandidatesCache: FileCandidate[] | null = null;
  private tagCandidatesCache: string[] | null = null;
  private projectedCandidates: NoteCandidate[] | null = null;

  constructor(private readonly app: App) {
    super();
    this.load();
  }

  override onload(): void {
    const invalidate = (): void => {
      this.invalidate();
    };
    this.registerEvent(this.app.vault.on("create", invalidate));
    this.registerEvent(this.app.vault.on("delete", invalidate));
    this.registerEvent(this.app.vault.on("rename", invalidate));
    this.registerEvent(this.app.vault.on("modify", invalidate));
    this.registerEvent(this.app.metadataCache.on("changed", invalidate));
    this.registerEvent(this.app.metadataCache.on("deleted", invalidate));
    this.registerEvent(this.app.workspace.on("file-open", invalidate));
    this.registerEvent(this.app.workspace.on("active-leaf-change", invalidate));
  }

  candidates(): readonly NoteCandidate[] {
    if (this.projectedCandidates) return this.projectedCandidates;

    const recentPaths = new Map(this.app.workspace.getLastOpenFiles().map((path, index) => [path, index]));
    const candidates = this.fileCandidates().map((candidate) => ({
      basename: candidate.basename,
      displayName: candidate.displayName,
      path: candidate.path,
      mtime: candidate.mtime,
      linktext: linktextForFile(this.app, candidate.file),
      headings: candidate.headings,
      recentIndex: recentPaths.get(candidate.path) ?? null,
    }));
    this.projectedCandidates = candidates;
    return candidates;
  }

  tags(): readonly string[] {
    this.fileCandidates();
    return this.tagCandidatesCache ?? [];
  }

  resolveFileReference(target: string): VaultFileReference | null {
    const file = this.app.metadataCache.getFirstLinkpathDest(target, "");
    return file ? { name: file.basename, path: fileReferencePath(file) } : null;
  }

  dispose(): void {
    this.unload();
  }

  override onunload(): void {
    this.invalidate();
  }

  private invalidate(): void {
    this.fileCandidatesCache = null;
    this.tagCandidatesCache = null;
    this.projectedCandidates = null;
  }

  private fileCandidates(): FileCandidate[] {
    if (this.fileCandidatesCache) return this.fileCandidatesCache;

    const tags: string[] = [];
    this.fileCandidatesCache = this.app.vault.getFiles().map((file) => {
      const cache = this.app.metadataCache.getFileCache(file);
      if (cache) tags.push(...(getAllTags(cache) ?? []));
      return {
        basename: file.basename,
        displayName: displayNameForFile(file),
        path: file.path,
        mtime: file.stat.mtime,
        file,
        headings: noteHeadings(cache),
      };
    });
    this.tagCandidatesCache = normalizedUniqueTags(tags);
    return this.fileCandidatesCache;
  }
}

function noteHeadings(cache: ReturnType<App["metadataCache"]["getFileCache"]>): NoteCandidate["headings"] {
  return (cache?.headings ?? []).map((heading) => ({
    heading: heading.heading,
    linkHeading: stripHeadingForLink(heading.heading),
    level: heading.level,
  }));
}
