import { type ArchiveExportSettings, type ArchiveThreadInput, archivedThreadMarkdown } from "../../../domain/threads/archive-markdown";
import { shortThreadId } from "../../../domain/threads/id";
import { threadArchiveTitle } from "../../../domain/threads/title";

export interface ArchiveExportResult {
  path: string;
}

export interface ArchiveExportDestination {
  normalizePath(path: string): string;
  exists(path: string): Promise<boolean>;
  createFolder(path: string): Promise<void>;
  createMarkdownFile(path: string, content: string): Promise<void>;
}

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
  await ensureFolder(destination, folder);

  const path = await uniqueMarkdownPath(destination, folder, filename, normalizePath);
  await destination.createMarkdownFile(path, archivedThreadMarkdown(thread, now, settings));
  return { path };
}

function templateContext(thread: ArchiveThreadInput, now: Date): TemplateContext {
  const title = sanitizePathSegment(threadArchiveTitle(thread));
  return {
    date: formatDate(now),
    time: formatTime(now),
    title,
    id: sanitizePathSegment(thread.id),
    shortId: sanitizePathSegment(shortThreadId(thread.id)),
  };
}

function expandTemplate(template: string, context: TemplateContext): string {
  return template.replace(/{{\s*(date|time|title|id|shortId)\s*}}/g, (_match, key: keyof TemplateContext) => context[key]);
}

function folderPathFromTemplate(template: string, context: TemplateContext, normalizePath: (path: string) => string): string {
  const expanded = expandTemplate(template, context).trim().replaceAll("\\", "/");
  if (!expanded) throw new Error("Archive export folder template produced an empty path.");
  if (expanded.startsWith("/") || /^[A-Za-z]:\//.test(expanded)) {
    throw new Error("Archive export folder must be relative to the vault.");
  }

  const segments = expanded
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 0) throw new Error("Archive export folder template produced an empty path.");
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("Archive export folder cannot contain relative path segments.");
  }
  const folder = normalizePath(segments.map(sanitizePathSegment).join("/"));
  if (!folder) throw new Error("Archive export folder template produced an empty path.");
  if (folder.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new Error("Archive export folder cannot contain relative path segments.");
  }
  return folder;
}

function filenameFromTemplate(template: string, context: TemplateContext, normalizePath: (path: string) => string): string {
  const expanded = expandTemplate(template, context)
    .trim()
    .replace(/[\\/]+/g, "-");
  const filename = normalizePath(sanitizePathSegment(expanded));
  if (!filename || filename === "." || filename === "..") {
    throw new Error("Archive export filename template produced an empty filename.");
  }
  return filename.toLowerCase().endsWith(".md") ? filename : `${filename}.md`;
}

async function ensureFolder(destination: ArchiveExportDestination, folder: string): Promise<void> {
  const segments = folder.split("/");
  for (let index = 0; index < segments.length; index += 1) {
    const path = segments.slice(0, index + 1).join("/");
    if (!(await destination.exists(path))) {
      await destination.createFolder(path);
    }
  }
}

async function uniqueMarkdownPath(
  destination: ArchiveExportDestination,
  folder: string,
  filename: string,
  normalizePath: (path: string) => string,
): Promise<string> {
  const dotIndex = filename.toLowerCase().endsWith(".md") ? filename.length - 3 : filename.length;
  const stem = filename.slice(0, dotIndex);
  const extension = filename.slice(dotIndex);
  let candidate = normalizePath(`${folder}/${filename}`);
  let suffix = 2;
  while (await destination.exists(candidate)) {
    candidate = normalizePath(`${folder}/${stem} ${String(suffix)}${extension}`);
    suffix += 1;
  }
  return candidate;
}

function sanitizePathSegment(value: string): string {
  return value
    .split("")
    .map((char) => (isUnsafePathChar(char) ? "-" : char))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+$/, "")
    .slice(0, 120)
    .trim();
}

function isUnsafePathChar(char: string): boolean {
  return char.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(char);
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
