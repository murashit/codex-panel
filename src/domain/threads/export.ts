import type { Thread } from "../../generated/app-server/v2/Thread";
import type { ThreadItem } from "../../generated/app-server/v2/ThreadItem";
import type { Turn } from "../../generated/app-server/v2/Turn";
import type { CodexPanelSettings } from "../../settings/model";
import { inputToText, shortThreadId } from "../../utils";
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

type ArchiveExportSettings = Pick<CodexPanelSettings, "archiveExportFolderTemplate" | "archiveExportFilenameTemplate"> &
  Partial<Pick<CodexPanelSettings, "archiveExportTags">>;

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
  await adapter.write(path, markdownFromThread(thread, now, settings));
  return { path };
}

export function markdownFromThread(thread: Thread, exportedAt = new Date(), settings?: Partial<ArchiveExportSettings>): string {
  const title = exportThreadTitle(thread);
  const tags = normalizedArchiveTags(settings?.archiveExportTags ?? "");
  const lines = [
    "---",
    `title: ${yamlString(title)}`,
    `thread_id: ${yamlString(thread.id)}`,
    `created: ${yamlString(formatDate(exportedAt))}`,
    ...frontmatterTagsLines(tags),
    "---",
    "",
    `# ${title}`,
    "",
    ...turnMarkdownLines(thread.turns),
  ];
  return `${trimTrailingBlankLines(lines).join("\n")}\n`;
}

export function normalizedArchiveTags(value: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const rawTag of value.split(",")) {
    const tag = stripMatchingQuotes(stripLeadingHashes(rawTag.trim()).trim()).trim();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }
  return tags;
}

function turnMarkdownLines(turns: Turn[]): string[] {
  return [...turns]
    .sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))
    .flatMap((turn) => turn.items.flatMap((item) => markdownLinesFromItem(item, turn)));
}

function markdownLinesFromItem(item: ThreadItem, turn: Turn): string[] {
  if (item.type === "userMessage") {
    const text = inputToText(item.content).trim();
    if (!text) return [];
    const heading = timestampedHeading("User", turn.startedAt);
    const referenced = referencedThreadDisplayFromPrompt(text);
    if (referenced) {
      return [
        heading,
        "",
        referenced.text,
        "",
        `> Referenced: ${referenced.reference.title} (${String(referenced.reference.includedTurns)}/${String(referenced.reference.turnLimit)} turns, ${referenced.reference.threadId})`,
        "",
      ];
    }
    return [heading, "", text, ""];
  }
  if (item.type === "agentMessage") {
    const text = item.text.trim();
    return text ? [timestampedHeading("Codex", turn.completedAt ?? turn.startedAt), "", text, ""] : [];
  }
  if (item.type === "plan") {
    const text = item.text.trim();
    return text ? [timestampedHeading("Proposed plan", turn.completedAt ?? turn.startedAt), "", text, ""] : [];
  }
  return [];
}

function timestampedHeading(label: string, unixSeconds: number | null): string {
  const timestamp = formatUnixTimestamp(unixSeconds);
  return timestamp ? `## ${label} - ${timestamp}` : `## ${label}`;
}

function formatUnixTimestamp(unixSeconds: number | null): string | null {
  if (!Number.isFinite(unixSeconds) || !unixSeconds || unixSeconds <= 0) return null;
  const date = new Date(unixSeconds * 1000);
  if (!Number.isFinite(date.getTime())) return null;
  return `${formatDate(date)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function frontmatterTagsLines(tags: string[]): string[] {
  return tags.length > 0 ? [`tags: [${tags.map(yamlString).join(", ")}]`] : [];
}

function stripLeadingHashes(value: string): string {
  return value.replace(/^#+/, "");
}

function stripMatchingQuotes(value: string): string {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  return (first === `"` || first === `'`) && first === last ? value.slice(1, -1) : value;
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
    candidate = `${folder}/${stem} ${String(suffix)}${extension}`;
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
  return `${String(date.getFullYear())}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
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
