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

export interface WebClipDestination {
  normalizePath(path: string): string;
  exists(path: string): Promise<boolean>;
  createFolder(path: string): Promise<void>;
  createMarkdownFile(path: string, content: string): Promise<void>;
}

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
  await ensureFolder(destination, folder);

  const path = await uniqueMarkdownPath(destination, folder, filename, normalizePath);
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
  const title = sanitizePathSegment(normalizedDisplayTitle(page.title));
  return {
    date: formatDate(now),
    time: formatTime(now),
    title,
    site: sanitizePathSegment(page.site?.trim() || ""),
    domain: sanitizePathSegment(page.domain?.trim() || hostnameFromUrl(page.url) || ""),
  };
}

function normalizedDisplayTitle(title: string): string {
  return title.replace(/\s+/g, " ").trim() || DEFAULT_CLIP_TITLE;
}

function expandTemplate(template: string, context: TemplateContext): string {
  return template.replace(/{{\s*(date|time|title|site|domain)\s*}}/g, (_match, key: keyof TemplateContext) => context[key]);
}

function folderPath(value: string, normalizePath: (path: string) => string): string {
  const raw = value.trim().replaceAll("\\", "/");
  if (!raw) throw new Error("Clip folder produced an empty path.");
  if (raw.startsWith("/") || /^[A-Za-z]:\//.test(raw)) throw new Error("Clip folder must be relative to the vault.");

  const rawSegments = raw
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (rawSegments.length === 0) throw new Error("Clip folder produced an empty path.");
  if (rawSegments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("Clip folder cannot contain relative path segments.");
  }

  const folder = normalizePath(rawSegments.map(sanitizePathSegment).filter(Boolean).join("/"));
  if (!folder) throw new Error("Clip folder produced an empty path.");
  if (folder.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new Error("Clip folder cannot contain relative path segments.");
  }
  return folder;
}

function filenameFromTemplate(template: string, context: TemplateContext, normalizePath: (path: string) => string): string {
  const expanded = expandTemplate(template, context)
    .trim()
    .replace(/[\\/]+/g, "-");
  const filename = normalizePath(sanitizePathSegment(expanded));
  if (!filename || filename === "." || filename === "..") throw new Error("Clip filename template produced an empty filename.");
  return filename.toLowerCase().endsWith(".md") ? filename : `${filename}.md`;
}

async function ensureFolder(destination: WebClipDestination, folder: string): Promise<void> {
  const segments = folder.split("/");
  for (let index = 0; index < segments.length; index += 1) {
    const path = segments.slice(0, index + 1).join("/");
    if (!(await destination.exists(path))) await destination.createFolder(path);
  }
}

async function uniqueMarkdownPath(
  destination: WebClipDestination,
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
  return char.charCodeAt(0) < 32 || '<>:"/\\|?*[]#^'.includes(char);
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
