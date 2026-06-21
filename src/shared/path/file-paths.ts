export interface ParsedFileHref {
  path: string;
  subpath: string;
}

export interface VaultRelativePathOptions {
  allowRelative?: boolean;
}

export function parseFileHref(href: string): ParsedFileHref | null {
  const trimmed = href.trim();
  if (!trimmed || isExternalFileHref(trimmed)) return null;

  const fragmentIndex = trimmed.indexOf("#");
  const withoutFragment = fragmentIndex === -1 ? trimmed : trimmed.slice(0, fragmentIndex);
  if (!withoutFragment) return null;

  const decoded = decodeFileHref(withoutFragment);
  const path = decoded.replace(/:(\d+)(?::\d+)?$/, "");
  const subpath = fragmentIndex === -1 ? "" : decodeFileHref(trimmed.slice(fragmentIndex));
  return path ? { path, subpath } : null;
}

export function isExternalFileHref(href: string): boolean {
  if (isWindowsAbsolutePath(href)) return false;
  return /^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith("//");
}

export function vaultRelativePath(vaultPath: string, path: string, options: VaultRelativePathOptions = {}): string | null {
  const normalizedPath = normalizeFilePath(path);
  const normalizedVaultPath = normalizeFilePath(vaultPath);
  if (!normalizedPath || !normalizedVaultPath) return null;

  if (!isFilesystemAbsolutePath(normalizedPath)) return options.allowRelative === true ? normalizedPath : null;
  if (normalizedPath === normalizedVaultPath) return null;

  const vaultPrefix = normalizedVaultPath.endsWith("/") ? normalizedVaultPath : `${normalizedVaultPath}/`;
  return normalizedPath.startsWith(vaultPrefix) ? normalizedPath.slice(vaultPrefix.length) : null;
}

export function pathRelativeToRoot(path: string, root?: string | null): string {
  const normalizedPath = normalizeFilePath(path);
  const normalizedRoot = normalizeFilePath(root ?? "");
  if (!normalizedRoot) return normalizedPath;
  if (normalizedPath === normalizedRoot) return ".";
  return normalizedPath.startsWith(`${normalizedRoot}/`) ? normalizedPath.slice(normalizedRoot.length + 1) : normalizedPath;
}

export function isFilesystemAbsolutePath(path: string): boolean {
  return path.startsWith("/") || isWindowsAbsolutePath(path);
}

export function isVaultConfigPath(path: string, configDir: string): boolean {
  const normalizedPath = normalizeFilePath(path);
  const normalizedConfigDir = normalizeFilePath(configDir);
  return normalizedPath === normalizedConfigDir || normalizedPath.startsWith(`${normalizedConfigDir}/`);
}

export function normalizeFilePath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
  return normalized.replace(/^\.\//, "");
}

function decodeFileHref(href: string): string {
  try {
    return decodeURI(href);
  } catch {
    return href;
  }
}

function isWindowsAbsolutePath(path: string): boolean {
  return /^[a-z]:[\\/]/i.test(path);
}
