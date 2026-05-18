import type { Thread } from "../generated/app-server/v2/Thread";
import type { ThreadItem } from "../generated/app-server/v2/ThreadItem";
import type { Turn } from "../generated/app-server/v2/Turn";
import type { CodexPanelSettings } from "../settings/model";
import { inputToText, shortThreadId } from "../utils";
import { getThreadTitle } from "./model";
import { referencedThreadDisplayFromPrompt } from "./reference";

export interface ArchiveExportAdapter {
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  write(path: string, data: string): Promise<void>;
}

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

type ArchiveExportSettings = Pick<CodexPanelSettings, "archiveExportFolderTemplate" | "archiveExportFilenameTemplate">;

export async function exportArchivedThreadMarkdown(
  thread: Thread,
  settings: ArchiveExportSettings,
  adapter: ArchiveExportAdapter,
  now = new Date(),
): Promise<ArchiveExportResult> {
  const context = templateContext(thread, now);
  const folder = folderPathFromTemplate(settings.archiveExportFolderTemplate, context);
  const filename = filenameFromTemplate(settings.archiveExportFilenameTemplate, context);
  await ensureFolder(adapter, folder);

  const path = await uniqueMarkdownPath(adapter, folder, filename);
  await adapter.write(path, markdownFromThread(thread, now));
  return { path };
}

export function markdownFromThread(thread: Thread, exportedAt = new Date()): string {
  const title = exportThreadTitle(thread);
  const lines = [
    "---",
    `title: ${yamlString(title)}`,
    `thread_id: ${yamlString(thread.id)}`,
    `created: ${yamlString(formatDate(exportedAt))}`,
    "---",
    "",
    `# ${title}`,
    "",
    ...turnMarkdownLines(thread.turns),
  ];
  return `${trimTrailingBlankLines(lines).join("\n")}\n`;
}

function turnMarkdownLines(turns: Turn[]): string[] {
  return [...turns].sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0)).flatMap((turn) => turn.items.flatMap(markdownLinesFromItem));
}

function markdownLinesFromItem(item: ThreadItem): string[] {
  if (item.type === "userMessage") {
    const text = inputToText(item.content).trim();
    if (!text) return [];
    const referenced = referencedThreadDisplayFromPrompt(text);
    if (referenced) {
      return [
        "## User",
        "",
        referenced.text,
        "",
        `> Referenced: ${referenced.reference.title} (${referenced.reference.includedTurns}/${referenced.reference.turnLimit} turns, ${referenced.reference.threadId})`,
        "",
      ];
    }
    return ["## User", "", text, ""];
  }
  if (item.type === "agentMessage") {
    const text = item.text.trim();
    return text ? ["## Codex", "", text, ""] : [];
  }
  if (item.type === "plan") {
    const text = item.text.trim();
    return text ? ["## Proposed plan", "", text, ""] : [];
  }
  return [];
}

function templateContext(thread: Thread, now: Date): TemplateContext {
  const title = sanitizePathSegment(exportThreadTitle(thread));
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
    candidate = `${folder}/${stem} ${suffix}${extension}`;
    suffix += 1;
  }
  return candidate;
}

function exportThreadTitle(thread: Thread): string {
  return getThreadTitle(thread) || "Untitled thread";
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

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function formatDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function formatTime(date: Date): string {
  return `${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

function trimTrailingBlankLines(lines: string[]): string[] {
  const result = [...lines];
  while (result[result.length - 1] === "") result.pop();
  return result;
}
