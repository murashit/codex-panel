import { type ArchiveExportSettings, type ArchiveThreadInput, archivedThreadMarkdown } from "../../../domain/threads/archive-markdown";
import { shortThreadId } from "../../../domain/threads/id";
import { threadArchiveTitle } from "../../../domain/threads/title";
import {
  vaultMarkdownFilenameFromTemplate,
  vaultMarkdownFolderPath,
  vaultMarkdownTemplateDate,
  vaultMarkdownTemplateTime,
} from "../../../domain/vault/markdown-write-templates";
import {
  ensureVaultFolder,
  sanitizeVaultPathSegment,
  uniqueVaultPath,
  type VaultMarkdownDestination,
  withVaultWriteLock,
} from "../../../domain/vault/write-paths";

export interface ArchiveExportResult {
  path: string;
}

export type ArchiveExportDestination = VaultMarkdownDestination;

interface TemplateContext {
  date: string;
  time: string;
  title: string;
  id: string;
  shortId: string;
}

export async function exportArchivedThreadMarkdown(
  thread: ArchiveThreadInput,
  settings: ArchiveExportSettings,
  destination: ArchiveExportDestination,
  now = new Date(),
): Promise<ArchiveExportResult> {
  const context = templateContext(thread, now);
  const normalizePath = (path: string): string => destination.normalizePath(path);
  const folder = folderPath(settings.archiveExportFolderTemplate, normalizePath);
  const filename = filenameFromTemplate(settings.archiveExportFilenameTemplate, context, normalizePath);
  return withVaultWriteLock(destination, async () => {
    await ensureVaultFolder(destination, folder);
    const path = await uniqueVaultPath(destination, folder, filename);
    await destination.createMarkdownFile(path, archivedThreadMarkdown(thread, now, settings));
    return { path };
  });
}

function templateContext(thread: ArchiveThreadInput, now: Date): TemplateContext {
  const title = sanitizeVaultPathSegment(threadArchiveTitle(thread));
  return {
    date: vaultMarkdownTemplateDate(now),
    time: vaultMarkdownTemplateTime(now),
    title,
    id: sanitizeVaultPathSegment(thread.id),
    shortId: sanitizeVaultPathSegment(shortThreadId(thread.id)),
  };
}

function folderPath(value: string, normalizePath: (path: string) => string): string {
  return vaultMarkdownFolderPath(value, normalizePath, {
    emptyPathMessage: "Archive export folder produced an empty path.",
    absolutePathMessage: "Archive export folder must be relative to the vault.",
    relativeSegmentMessage: "Archive export folder cannot contain relative path segments.",
  });
}

function filenameFromTemplate(template: string, context: TemplateContext, normalizePath: (path: string) => string): string {
  return vaultMarkdownFilenameFromTemplate(
    template,
    context,
    normalizePath,
    "Archive export filename template produced an empty filename.",
  );
}
