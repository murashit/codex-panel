import { shortThreadId } from "../../../domain/threads/id";
import { threadDisplayTitle } from "../../../domain/threads/title";
import type { ThreadTranscript } from "../../../domain/threads/transcript";
import { sanitizeVaultPathSegment, vaultRelativeFolderPath } from "../../../domain/vault/write-paths";
import {
  ensureVaultFolder,
  uniqueVaultPath,
  type VaultMarkdownDestination,
  withVaultWriteLock,
} from "../../../shared/vault/write-operations";
import { type ArchiveMarkdownOptions, archivedThreadMarkdown } from "./archive-markdown";

export interface ArchiveExportResult {
  path: string;
}

export interface ArchiveExportSettings extends ArchiveMarkdownOptions {
  archiveExportFolderTemplate: string;
  archiveExportFilenameTemplate: string;
}

export type ArchiveExportDestination = VaultMarkdownDestination;

export async function exportArchivedThreadMarkdown(
  thread: ThreadTranscript,
  settings: ArchiveExportSettings,
  destination: ArchiveExportDestination,
  now = new Date(),
): Promise<ArchiveExportResult> {
  const normalizePath = (path: string): string => destination.normalizePath(path);
  const folder = folderPath(settings.archiveExportFolderTemplate, normalizePath);
  const filename = filenameFromTemplate(settings.archiveExportFilenameTemplate, thread, now, normalizePath);
  return withVaultWriteLock(destination, async () => {
    await ensureVaultFolder(destination, folder);
    const path = await uniqueVaultPath(destination, folder, filename);
    await destination.createMarkdownFile(path, archivedThreadMarkdown(thread, now, settings));
    return { path };
  });
}

function folderPath(value: string, normalizePath: (path: string) => string): string {
  return vaultRelativeFolderPath(value, {
    normalizePath,
    emptyPathMessage: "Archive export folder produced an empty path.",
    absolutePathMessage: "Archive export folder must be relative to the vault.",
    relativeSegmentMessage: "Archive export folder cannot contain relative path segments.",
  });
}

function filenameFromTemplate(template: string, thread: ThreadTranscript, now: Date, normalizePath: (path: string) => string): string {
  const context: Record<string, string> = {
    date: `${String(now.getFullYear())}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`,
    time: `${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`,
    title: sanitizeVaultPathSegment(threadDisplayTitle(thread)),
    id: sanitizeVaultPathSegment(thread.id),
    shortId: sanitizeVaultPathSegment(shortThreadId(thread.id)),
  };
  const expanded = template
    .replace(/{{\s*([A-Za-z][A-Za-z0-9]*)\s*}}/g, (match, key: string) => context[key] ?? match)
    .trim()
    .replace(/[\\/]+/g, "-");
  const filename = normalizePath(sanitizeVaultPathSegment(expanded));
  if (!filename || filename === "." || filename === "..") throw new Error("Archive export filename template produced an empty filename.");
  return filename.toLowerCase().endsWith(".md") ? filename : `${filename}.md`;
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}
