import { sanitizeVaultPathSegment, vaultRelativeFolderPath } from "../../../domain/vault/write-paths";

interface VaultFolderMessages {
  emptyPathMessage: string;
  absolutePathMessage: string;
  relativeSegmentMessage: string;
}

const TEMPLATE_TOKEN_PATTERN = /{{\s*([A-Za-z][A-Za-z0-9]*)\s*}}/g;

export function vaultMarkdownTemplateDate(date: Date): string {
  return `${String(date.getFullYear())}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function vaultMarkdownTemplateTime(date: Date): string {
  return `${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
}

function expandVaultMarkdownTemplate(template: string, context: object): string {
  const values = context as Record<string, string | undefined>;
  return template.replace(TEMPLATE_TOKEN_PATTERN, (match, key: string) => values[key] ?? match);
}

export function vaultMarkdownFolderPath(value: string, normalizePath: (path: string) => string, messages: VaultFolderMessages): string {
  return vaultRelativeFolderPath(value.trim().replaceAll("\\", "/"), {
    normalizePath,
    emptyPathMessage: messages.emptyPathMessage,
    absolutePathMessage: messages.absolutePathMessage,
    relativeSegmentMessage: messages.relativeSegmentMessage,
  });
}

export function vaultMarkdownFilenameFromTemplate(
  template: string,
  context: object,
  normalizePath: (path: string) => string,
  emptyFilenameMessage: string,
): string {
  const expanded = expandVaultMarkdownTemplate(template, context)
    .trim()
    .replace(/[\\/]+/g, "-");
  const filename = normalizePath(sanitizeVaultPathSegment(expanded));
  if (!filename || filename === "." || filename === "..") throw new Error(emptyFilenameMessage);
  return filename.toLowerCase().endsWith(".md") ? filename : `${filename}.md`;
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}
