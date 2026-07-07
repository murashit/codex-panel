import { yamlFrontmatterInlineList, yamlFrontmatterString } from "../../../../domain/markdown/frontmatter";
import {
  vaultMarkdownFilenameFromTemplate,
  vaultMarkdownFolderPath,
  vaultMarkdownTemplateDate,
  vaultMarkdownTemplateTime,
} from "../../../../domain/vault/markdown-write-templates";
import {
  ensureVaultFolder,
  sanitizeVaultPathSegment,
  uniqueVaultPath,
  type VaultMarkdownDestination,
} from "../../../../domain/vault/write-paths";

export interface WebClipSettings {
  clipFolder: string;
  clipFilenameTemplate: string;
  clipTags?: string;
}

export interface WebClipPage {
  url: string;
  title: string;
  content: string;
  site?: string | null;
  domain?: string | null;
}

export type WebClipDestination = VaultMarkdownDestination;

export interface WebClipResult {
  path: string;
  wikilink: string;
}

interface TemplateContext {
  date: string;
  time: string;
  title: string;
  site: string;
  domain: string;
}

const DEFAULT_CLIP_TITLE = "Untitled clip";

export async function saveWebClipMarkdown(
  page: WebClipPage,
  settings: WebClipSettings,
  destination: WebClipDestination,
  now = new Date(),
): Promise<WebClipResult> {
  const context = templateContext(page, now);
  const normalizePath = (path: string): string => destination.normalizePath(path);
  const folder = folderPath(settings.clipFolder, normalizePath);
  const filename = filenameFromTemplate(settings.clipFilenameTemplate, context, normalizePath);
  await ensureVaultFolder(destination, folder);

  const path = await uniqueVaultPath(destination, folder, filename);
  await destination.createMarkdownFile(path, webClipMarkdown(page, settings, context.title, now));
  return { path, wikilink: `[[${path}]]` };
}

export function webClipMarkdown(page: WebClipPage, settings: Pick<WebClipSettings, "clipTags">, title?: string, now = new Date()): string {
  const normalizedTitle = normalizedDisplayTitle(title ?? page.title);
  const tags = normalizedClipTags(settings.clipTags ?? "");
  const frontmatter = [
    "---",
    `title: ${yamlFrontmatterString(normalizedTitle)}`,
    `url: ${yamlFrontmatterString(page.url)}`,
    `created: ${yamlFrontmatterString(now.toISOString())}`,
    ...frontmatterTagsLines(tags),
    "---",
    "",
  ];
  return [...frontmatter, `# ${normalizedTitle}`, "", page.content.trim(), ""].join("\n");
}

function templateContext(page: WebClipPage, now: Date): TemplateContext {
  const title = sanitizeVaultPathSegment(normalizedDisplayTitle(page.title));
  return {
    date: vaultMarkdownTemplateDate(now),
    time: vaultMarkdownTemplateTime(now),
    title,
    site: sanitizeVaultPathSegment(page.site?.trim() || ""),
    domain: sanitizeVaultPathSegment(page.domain?.trim() || hostnameFromUrl(page.url) || ""),
  };
}

function normalizedDisplayTitle(title: string): string {
  return title.replace(/\s+/g, " ").trim() || DEFAULT_CLIP_TITLE;
}

function folderPath(value: string, normalizePath: (path: string) => string): string {
  return vaultMarkdownFolderPath(value, normalizePath, {
    emptyPathMessage: "Clip folder produced an empty path.",
    absolutePathMessage: "Clip folder must be relative to the vault.",
    relativeSegmentMessage: "Clip folder cannot contain relative path segments.",
  });
}

function filenameFromTemplate(template: string, context: TemplateContext, normalizePath: (path: string) => string): string {
  return vaultMarkdownFilenameFromTemplate(template, context, normalizePath, "Clip filename template produced an empty filename.");
}

function normalizedClipTags(input: string): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const raw of input.split(",")) {
    const tag = raw
      .trim()
      .replace(/^#/, "")
      .replace(/^["']|["']$/g, "")
      .trim();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }
  return tags;
}

function frontmatterTagsLines(tags: string[]): string[] {
  return tags.length > 0 ? [`tags: ${yamlFrontmatterInlineList(tags)}`] : [];
}

function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}
