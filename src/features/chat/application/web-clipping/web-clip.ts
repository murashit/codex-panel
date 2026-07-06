import {
  ensureVaultFolder,
  sanitizeVaultPathSegment,
  uniqueVaultPath,
  type VaultMarkdownDestination,
  vaultRelativeFolderPath,
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
    `title: ${yamlString(normalizedTitle)}`,
    `url: ${yamlString(page.url)}`,
    `created: ${yamlString(now.toISOString())}`,
    ...frontmatterTagsLines(tags),
    "---",
    "",
  ];
  return [...frontmatter, `# ${normalizedTitle}`, "", page.content.trim(), ""].join("\n");
}

function templateContext(page: WebClipPage, now: Date): TemplateContext {
  const title = sanitizeVaultPathSegment(normalizedDisplayTitle(page.title));
  return {
    date: formatDate(now),
    time: formatTime(now),
    title,
    site: sanitizeVaultPathSegment(page.site?.trim() || ""),
    domain: sanitizeVaultPathSegment(page.domain?.trim() || hostnameFromUrl(page.url) || ""),
  };
}

function normalizedDisplayTitle(title: string): string {
  return title.replace(/\s+/g, " ").trim() || DEFAULT_CLIP_TITLE;
}

function expandTemplate(template: string, context: TemplateContext): string {
  return template.replace(/{{\s*(date|time|title|site|domain)\s*}}/g, (_match, key: keyof TemplateContext) => context[key]);
}

function folderPath(value: string, normalizePath: (path: string) => string): string {
  return vaultRelativeFolderPath(value, {
    normalizePath,
    emptyPathMessage: "Clip folder produced an empty path.",
    absolutePathMessage: "Clip folder must be relative to the vault.",
    relativeSegmentMessage: "Clip folder cannot contain relative path segments.",
  });
}

function filenameFromTemplate(template: string, context: TemplateContext, normalizePath: (path: string) => string): string {
  const expanded = expandTemplate(template, context)
    .trim()
    .replace(/[\\/]+/g, "-");
  const filename = normalizePath(sanitizeVaultPathSegment(expanded));
  if (!filename || filename === "." || filename === "..") throw new Error("Clip filename template produced an empty filename.");
  return filename.toLowerCase().endsWith(".md") ? filename : `${filename}.md`;
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
  return tags.length > 0 ? [`tags: [${tags.map(yamlString).join(", ")}]`] : [];
}

function yamlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
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
