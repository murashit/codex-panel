import type { Link, Nodes } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { toMarkdown } from "mdast-util-to-markdown";
import { visit } from "unist-util-visit";

import { parseFileHref } from "../vault/file-hrefs";
import { isFilesystemAbsolutePath, isVaultConfigPath, normalizeFilePath, vaultRelativePath } from "../vault/paths";
import type { Thread } from "./model";
import { threadDisplayTitle } from "./title";
import type { ThreadTranscriptEntry } from "./transcript";

interface MarkdownSourceReplacement {
  start: number;
  end: number;
  value: string;
}

export interface ArchiveMarkdownOptions {
  archiveExportTags?: string;
  vaultPath?: string;
  vaultConfigDir?: string;
}

export interface ArchiveThreadInput extends Thread {
  transcriptEntries: readonly ThreadTranscriptEntry[];
}

export function archivedThreadMarkdown(thread: ArchiveThreadInput, exportedAt = new Date(), settings: ArchiveMarkdownOptions = {}): string {
  const title = threadDisplayTitle(thread);
  const tags = normalizedArchiveTags(settings.archiveExportTags ?? "");
  const frontmatter = [
    "---",
    `title: ${yamlFrontmatterString(title)}`,
    `thread_id: ${yamlFrontmatterString(thread.id)}`,
    `created: ${yamlFrontmatterString(formatDate(exportedAt))}`,
    ...frontmatterTagsLines(tags),
    "---",
  ].join("\n");
  const body = `${trimTrailingBlankLines([`# ${title}`, "", ...transcriptMarkdownLines(thread.transcriptEntries)]).join("\n")}\n`;
  const normalizedBody = settings.vaultPath ? normalizeExportedMarkdownLinks(body, settings.vaultPath, settings.vaultConfigDir) : body;
  return `${frontmatter}\n\n${normalizedBody}`;
}

function normalizeExportedMarkdownLinks(markdown: string, vaultPath: string, vaultConfigDir: string | null | undefined): string {
  const replacements: MarkdownSourceReplacement[] = [];
  visit(fromMarkdown(markdown), "link", (link) => {
    const replacement = normalizedExportedMarkdownLink(link, vaultPath, vaultConfigDir);
    if (replacement) replacements.push(replacement);
  });
  let output = markdown;
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    output = `${output.slice(0, replacement.start)}${replacement.value}${output.slice(replacement.end)}`;
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
      return [
        heading,
        "",
        entry.text,
        "",
        ...(entry.referencedThread
          ? [
              `> Referenced: ${entry.referencedThread.title} (${String(entry.referencedThread.includedTurns)}/${String(entry.referencedThread.turnLimit)} turns${entry.referencedThread.truncated ? ", truncated" : ""}, ${entry.referencedThread.threadId})`,
              "",
            ]
          : []),
        ...(entry.contexts ?? []).flatMap((context) => [`> Context: ${archiveContextLabel(context, entry.text)}`, ""]),
      ];
    }
    case "assistant":
      return [timestampedHeading("Codex", entry.timestamp), "", entry.text, ""];
    case "plan":
      return [timestampedHeading("Proposed plan", entry.timestamp), "", entry.text, ""];
  }
}

function archiveContextLabel(context: NonNullable<ThreadTranscriptEntry["contexts"]>[number], visibleText: string): string {
  const truncated = context.truncated ? " (truncated)" : "";
  if (context.kind === "obsidian") return `Obsidian context${truncated}`;
  const url = visibleWebUrl(visibleText);
  return `Web page${truncated}${url ? ` (${url})` : ""}`;
}

function visibleWebUrl(text: string): string | null {
  const firstToken = text.trim().split(/\s+/, 1)[0] ?? "";
  try {
    const parsed = new URL(firstToken);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
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
  return tags.length > 0 ? [`tags: ${yamlFrontmatterInlineList(tags)}`] : [];
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

function normalizedExportedMarkdownLink(
  link: Link,
  vaultPath: string,
  vaultConfigDir: string | null | undefined,
): MarkdownSourceReplacement | null {
  const start = link.position?.start.offset;
  const end = link.position?.end.offset;
  if (start === undefined || end === undefined || !link.url) return null;

  const parsed = parseFileHref(link.url);
  if (!parsed) return null;
  const vaultRelative = vaultRelativePath(vaultPath, parsed.path);
  if (vaultRelative && !archiveExportShouldKeepAbsolute(vaultRelative, vaultConfigDir)) {
    return {
      start,
      end,
      value: markdownNodeSource({ ...link, url: `${vaultRelative}${parsed.subpath}` }),
    };
  }

  if (!isFilesystemAbsolutePath(normalizeFilePath(parsed.path))) return null;
  return {
    start,
    end,
    value: markdownNodeSource({
      type: "paragraph",
      children: [...link.children, { type: "text", value: " (" }, { type: "inlineCode", value: link.url }, { type: "text", value: ")" }],
    }),
  };
}

function markdownNodeSource(node: Nodes): string {
  return toMarkdown(node, { unsafe: [{ character: "|", inConstruct: ["label", "phrasing"] }] }).trimEnd();
}

function archiveExportShouldKeepAbsolute(vaultRelativePath: string, vaultConfigDir: string | null | undefined): boolean {
  return typeof vaultConfigDir === "string" && vaultConfigDir.length > 0 && isVaultConfigPath(vaultRelativePath, vaultConfigDir);
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

function yamlFrontmatterString(value: string): string {
  return JSON.stringify(value);
}

function yamlFrontmatterInlineList(values: readonly string[]): string {
  return `[${values.map(yamlFrontmatterString).join(", ")}]`;
}
