import { type ArchiveExportSettings, type ArchiveThreadInput, archivedThreadMarkdown } from "../../../domain/threads/archive-markdown";
import { shortThreadId } from "../../../domain/threads/id";
import { threadArchiveTitle } from "../../../domain/threads/title";
import {
  ensureVaultFolder,
  sanitizeVaultPathSegment,
  uniqueVaultPath,
  type VaultMarkdownDestination,
  vaultRelativeFolderPath,
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
  const folder = folderPathFromTemplate(settings.archiveExportFolderTemplate, context, normalizePath);
  const filename = filenameFromTemplate(settings.archiveExportFilenameTemplate, context, normalizePath);
  await ensureVaultFolder(destination, folder);

  const path = await uniqueVaultPath(destination, folder, filename);
  await destination.createMarkdownFile(path, archivedThreadMarkdown(thread, now, settings));
  return { path };
}

function templateContext(thread: ArchiveThreadInput, now: Date): TemplateContext {
  const title = sanitizeVaultPathSegment(threadArchiveTitle(thread));
  return {
    date: formatDate(now),
    time: formatTime(now),
    title,
    id: sanitizeVaultPathSegment(thread.id),
    shortId: sanitizeVaultPathSegment(shortThreadId(thread.id)),
  };
}

function expandTemplate(template: string, context: TemplateContext): string {
  return template.replace(/{{\s*(date|time|title|id|shortId)\s*}}/g, (_match, key: keyof TemplateContext) => context[key]);
}

function folderPathFromTemplate(template: string, context: TemplateContext, normalizePath: (path: string) => string): string {
  const expanded = expandTemplate(template, context).trim().replaceAll("\\", "/");
  return vaultRelativeFolderPath(expanded, {
    normalizePath,
    emptyPathMessage: "Archive export folder template produced an empty path.",
    absolutePathMessage: "Archive export folder must be relative to the vault.",
    relativeSegmentMessage: "Archive export folder cannot contain relative path segments.",
  });
}

function filenameFromTemplate(template: string, context: TemplateContext, normalizePath: (path: string) => string): string {
  const expanded = expandTemplate(template, context)
    .trim()
    .replace(/[\\/]+/g, "-");
  const filename = normalizePath(sanitizeVaultPathSegment(expanded));
  if (!filename || filename === "." || filename === "..") {
    throw new Error("Archive export filename template produced an empty filename.");
  }
  return filename.toLowerCase().endsWith(".md") ? filename : `${filename}.md`;
}

function formatDate(date: Date): string {
  return `${String(date.getFullYear())}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function formatTime(date: Date): string {
  return `${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}
