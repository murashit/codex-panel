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

  const folder = options.normalizePath(rawSegments.map(sanitizeVaultPathSegment).filter(Boolean).join("/"));
  if (!folder) return vaultFolderFallback(options);
  if (folder.split("/").some((segment) => segment === "." || segment === "..")) throw new Error(options.relativeSegmentMessage);
  return folder;
}

export function sanitizeVaultPathSegment(value: string): string {
  const normalized = Array.from(value)
    .map((char) => (isUnsafeVaultPathChar(char) ? "-" : char))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return truncateVaultPathSegment(normalized).trim().replace(/^\.+$/, "");
}

function truncateVaultPathSegment(value: string): string {
  let result = "";
  for (const character of value) {
    if (result.length + character.length > 120) break;
    result += character;
  }
  return result;
}

function vaultFolderFallback(options: VaultRelativeFolderPathOptions): string {
  if (options.emptyFallback === undefined) throw new Error(options.emptyPathMessage);
  return options.normalizePath(options.emptyFallback);
}

function isUnsafeVaultPathChar(char: string): boolean {
  const code = char.charCodeAt(0);
  return code < 32 || (char.length === 1 && code >= 0xd800 && code <= 0xdfff) || UNSAFE_VAULT_PATH_CHARS.includes(char);
}
