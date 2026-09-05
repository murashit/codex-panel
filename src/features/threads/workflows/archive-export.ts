import { shortThreadId } from "../../../domain/threads/id";
import { threadDisplayTitle } from "../../../domain/threads/title";
import type { ThreadTranscript } from "../../../domain/threads/transcript";
import { sanitizeVaultPathSegment } from "../../../domain/vault/write-paths";
import {
  ensureVaultFolder,
  uniqueVaultPath,
  type VaultMarkdownDestination,
  withVaultWriteLock,
} from "../../../shared/vault/write-operations";
import {
  vaultMarkdownFilenameFromTemplate,
  vaultMarkdownFolderPath,
  vaultMarkdownTemplateDate,
  vaultMarkdownTemplateTime,
} from "./archive-export-paths";
import { type ArchiveMarkdownOptions, archivedThreadMarkdown } from "./archive-markdown";

export interface ArchiveExportResult {
  path: string;
}

export interface ArchiveExportSettings extends ArchiveMarkdownOptions {
  archiveExportFolderTemplate: string;
  archiveExportFilenameTemplate: string;
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
  thread: ThreadTranscript,
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

function templateContext(thread: ThreadTranscript, now: Date): TemplateContext {
  const title = sanitizeVaultPathSegment(threadDisplayTitle(thread));
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
