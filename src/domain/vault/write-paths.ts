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
  return value
    .split("")
    .map((char) => (isUnsafeVaultPathChar(char) ? "-" : char))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+$/, "")
    .slice(0, 120)
    .trim();
}

function vaultFolderFallback(options: VaultRelativeFolderPathOptions): string {
  if (options.emptyFallback === undefined) throw new Error(options.emptyPathMessage);
  return options.normalizePath(options.emptyFallback);
}

function isUnsafeVaultPathChar(char: string): boolean {
  return char.charCodeAt(0) < 32 || UNSAFE_VAULT_PATH_CHARS.includes(char);
}
