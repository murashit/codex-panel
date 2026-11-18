import { truncateUtf8, utf8ByteLength } from "../text/text";

export interface VaultRelativeFolderPathOptions {
  normalizePath(path: string): string;
  emptyPathMessage: string;
  absolutePathMessage: string;
  relativeSegmentMessage: string;
  emptyFallback?: string;
}

const UNSAFE_VAULT_PATH_CHARS = '<>:"/\\|?*[]#^';

export function vaultRelativeFolderPath(value: string, options: VaultRelativeFolderPathOptions): string {
  const trimmed = value.trim();
  if (!trimmed) return vaultFolderFallback(options);

  const raw = trimmed.replaceAll("\\", "/");
  if (raw.startsWith("/") || /^[A-Za-z]:\//.test(raw)) throw new Error(options.absolutePathMessage);

  const rawSegments = raw
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (rawSegments.length === 0) return vaultFolderFallback(options);
  if (rawSegments.some((segment) => segment === "." || segment === "..")) throw new Error(options.relativeSegmentMessage);

  const folder = options.normalizePath(
    rawSegments
      .map((segment) => sanitizeVaultPathSegment(segment))
      .filter(Boolean)
      .join("/"),
  );
  if (!folder) return vaultFolderFallback(options);
  if (folder.split("/").some((segment) => segment === "." || segment === "..")) throw new Error(options.relativeSegmentMessage);
  return folder;
}

function normalizeVaultSegment(value: string): string {
  return Array.from(value)
    .map((char) => (isUnsafeVaultPathChar(char) ? "-" : char))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

export function sanitizeVaultPathSegment(value: string): string {
  return truncateUtf8(normalizeVaultSegment(value), 255, 120).trim().replace(/^\.+$/, "");
}

export function sanitizeVaultFilename(value: string): string {
  const normalized = normalizeVaultSegment(value.replace(/[\\/]+/g, "-")).replace(/^\.+$/, "");
  const { stem, extension } = splitVaultFilename(normalized);
  return fitVaultFilename(stem, extension, "", 120).trim();
}

export function fitVaultFilename(stem: string, extension: string, marker: string, maxLength: number): string {
  const firstCharacter = stem[Symbol.iterator]().next().value ?? "";
  const reserved = firstCharacter + marker;
  const ending = marker + truncateUtf8(extension, 255 - utf8ByteLength(reserved), maxLength - reserved.length);
  return truncateUtf8(stem, 255 - utf8ByteLength(ending), maxLength - ending.length) + ending;
}

function vaultFolderFallback(options: VaultRelativeFolderPathOptions): string {
  if (options.emptyFallback === undefined) throw new Error(options.emptyPathMessage);
  return options.normalizePath(options.emptyFallback);
}

function isUnsafeVaultPathChar(char: string): boolean {
  const code = char.charCodeAt(0);
  return code < 32 || (char.length === 1 && code >= 0xd800 && code <= 0xdfff) || UNSAFE_VAULT_PATH_CHARS.includes(char);
}

export function splitVaultFilename(filename: string): { stem: string; extension: string } {
  const dotIndex = filename.lastIndexOf(".");
  if (dotIndex <= 0) return { stem: filename, extension: "" };
  return {
    stem: filename.slice(0, dotIndex),
    extension: filename.slice(dotIndex),
  };
}
