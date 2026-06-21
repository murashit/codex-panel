import type { Thread } from "./model";
import { referencedThreadMetadataFromPrompt } from "./reference";
import { threadArchiveTitle } from "./title";
import type { ThreadTranscriptEntry } from "./transcript";
import {
  isExternalFileHref,
  isFilesystemAbsolutePath,
  isVaultConfigPath,
  normalizeFilePath,
  parseFileHref,
  vaultRelativePath,
} from "../../shared/path/file-paths";

interface ParsedMarkdownLink {
  raw: string;
  label: string;
  href: string;
  end: number;
}

export interface ArchiveExportSettings {
  archiveExportFolderTemplate: string;
  archiveExportFilenameTemplate: string;
  archiveExportTags?: string;
  vaultPath?: string;
  vaultConfigDir?: string;
}

export interface ArchiveExportAdapter {
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  write(path: string, data: string): Promise<void>;
}

export interface ArchiveThreadInput extends Thread {
  transcriptEntries: readonly ThreadTranscriptEntry[];
}

export function archivedThreadMarkdown(
  thread: ArchiveThreadInput,
  exportedAt = new Date(),
  settings?: Partial<ArchiveExportSettings>,
): string {
  const title = archivedThreadTitle(thread);
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
    ...transcriptMarkdownLines(thread.transcriptEntries),
  ];
  const markdown = `${trimTrailingBlankLines(lines).join("\n")}\n`;
  return settings?.vaultPath ? normalizeExportedMarkdownLinks(markdown, settings.vaultPath, settings.vaultConfigDir) : markdown;
}

export function archivedThreadTitle(thread: ArchiveThreadInput): string {
  return threadArchiveTitle(thread);
}

function normalizeExportedMarkdownLinks(markdown: string, vaultPath: string, vaultConfigDir: string | null | undefined): string {
  const lines = markdown.split("\n");
  let inFence = false;
  return lines
    .map((line) => {
      if (line.trimStart().startsWith("```")) {
        inFence = !inFence;
        return line;
      }
      return inFence ? line : normalizeExportedMarkdownLinksInLine(line, vaultPath, vaultConfigDir);
    })
    .join("\n");
}

function normalizeExportedMarkdownLinksInLine(line: string, vaultPath: string, vaultConfigDir: string | null | undefined): string {
  let output = "";
  let index = 0;
  while (index < line.length) {
    const parsed = parseMarkdownLinkAt(line, index);
    if (!parsed || isInsideInlineCode(line, index)) {
      output += line[index] ?? "";
      index += 1;
      continue;
    }

    output += normalizedExportedMarkdownLink(parsed, vaultPath, vaultConfigDir);
    index = parsed.end;
  }
  return output;
}

function normalizedArchiveTags(value: string): string[] {
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

function transcriptMarkdownLines(entries: readonly ThreadTranscriptEntry[]): string[] {
  return [...entries].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0)).flatMap(markdownLinesFromTranscriptEntry);
}

function markdownLinesFromTranscriptEntry(entry: ThreadTranscriptEntry): string[] {
  switch (entry.kind) {
    case "user": {
      const heading = timestampedHeading("User", entry.timestamp);
      const referenced = referencedThreadMetadataFromPrompt(entry.text);
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
      return [heading, "", entry.text, ""];
    }
    case "assistant":
      return [timestampedHeading("Codex", entry.timestamp), "", entry.text, ""];
    case "plan":
      return [timestampedHeading("Proposed plan", entry.timestamp), "", entry.text, ""];
  }
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

function unwrappedMarkdownHref(value: string): string {
  if (value.startsWith("<") && value.endsWith(">")) return value.slice(1, -1);
  return value;
}

function parseMarkdownLinkAt(line: string, start: number): ParsedMarkdownLink | null {
  if (line[start] !== "[" || line[start - 1] === "!") return null;

  const labelEnd = line.indexOf("]", start + 1);
  if (labelEnd === -1 || line[labelEnd + 1] !== "(") return null;

  const hrefStart = labelEnd + 2;
  const hrefEnd = line[hrefStart] === "<" ? line.indexOf(">)", hrefStart + 1) : line.indexOf(")", hrefStart);
  if (hrefEnd === -1) return null;

  const end = line[hrefStart] === "<" ? hrefEnd + 2 : hrefEnd + 1;
  return {
    raw: line.slice(start, end),
    label: line.slice(start + 1, labelEnd),
    href: line.slice(hrefStart, hrefEnd + (line[hrefStart] === "<" ? 1 : 0)),
    end,
  };
}

function normalizedExportedMarkdownLink(link: ParsedMarkdownLink, vaultPath: string, vaultConfigDir: string | null | undefined): string {
  const href = unwrappedMarkdownHref(link.href.trim());
  if (!href || isExternalFileHref(href)) return link.raw;

  const parsed = parseFileHref(href);
  if (!parsed) return link.raw;
  const vaultRelative = vaultRelativePath(vaultPath, parsed.path);
  if (vaultRelative && !archiveExportShouldKeepAbsolute(vaultRelative, vaultConfigDir)) {
    return `[${link.label}](${markdownHref(`${vaultRelative}${parsed.subpath}`)})`;
  }

  return isFilesystemAbsolutePath(normalizeFilePath(parsed.path)) ? `${link.label} (\`${href.replace(/`/g, "\\`")}\`)` : link.raw;
}

function archiveExportShouldKeepAbsolute(vaultRelativePath: string, vaultConfigDir: string | null | undefined): boolean {
  return typeof vaultConfigDir === "string" && vaultConfigDir.length > 0 && isVaultConfigPath(vaultRelativePath, vaultConfigDir);
}

function markdownHref(value: string): string {
  return /[\s()]/.test(value) ? `<${value}>` : value;
}

function isInsideInlineCode(line: string, offset: number): boolean {
  let inCode = false;
  for (let index = 0; index < offset; index += 1) {
    if (line[index] === "`") inCode = !inCode;
  }
  return inCode;
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function formatDate(date: Date): string {
  return `${String(date.getFullYear())}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

function trimTrailingBlankLines(lines: string[]): string[] {
  const result = [...lines];
  while (result[result.length - 1] === "") result.pop();
  return result;
}
