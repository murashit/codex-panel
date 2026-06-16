import {
  archivedThreadMarkdown,
  archivedThreadTitle,
  type ArchiveExportAdapter,
  type ArchiveExportSettings,
  type ArchiveThreadInput,
} from "../../domain/threads/archive-markdown";
import { shortThreadId } from "../../utils";

export interface ArchiveExportResult {
  path: string;
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
  adapter: ArchiveExportAdapter,
  now = new Date(),
): Promise<ArchiveExportResult> {
  const context = templateContext(thread, now);
  const folder = folderPathFromTemplate(settings.archiveExportFolderTemplate, context);
  const filename = filenameFromTemplate(settings.archiveExportFilenameTemplate, context);
  await ensureFolder(adapter, folder);

  const path = await uniqueMarkdownPath(adapter, folder, filename);
  await adapter.write(path, archivedThreadMarkdown(thread, now, settings));
  return { path };
}

function templateContext(thread: ArchiveThreadInput, now: Date): TemplateContext {
  const title = sanitizePathSegment(archivedThreadTitle(thread));
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

function folderPathFromTemplate(template: string, context: TemplateContext): string {
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
  return segments.map(sanitizePathSegment).join("/");
}

function filenameFromTemplate(template: string, context: TemplateContext): string {
  const expanded = expandTemplate(template, context)
    .trim()
    .replace(/[\\/]+/g, "-");
  const filename = sanitizePathSegment(expanded);
  if (!filename || filename === "." || filename === "..") {
    throw new Error("Archive export filename template produced an empty filename.");
  }
  return filename.toLowerCase().endsWith(".md") ? filename : `${filename}.md`;
}

async function ensureFolder(adapter: ArchiveExportAdapter, folder: string): Promise<void> {
  const segments = folder.split("/");
  for (let index = 0; index < segments.length; index += 1) {
    const path = segments.slice(0, index + 1).join("/");
    if (!(await adapter.exists(path))) {
      await adapter.mkdir(path);
    }
  }
}

async function uniqueMarkdownPath(adapter: ArchiveExportAdapter, folder: string, filename: string): Promise<string> {
  const dotIndex = filename.toLowerCase().endsWith(".md") ? filename.length - 3 : filename.length;
  const stem = filename.slice(0, dotIndex);
  const extension = filename.slice(dotIndex);
  let candidate = `${folder}/${filename}`;
  let suffix = 2;
  while (await adapter.exists(candidate)) {
    candidate = `${folder}/${stem} ${String(suffix)}${extension}`;
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
