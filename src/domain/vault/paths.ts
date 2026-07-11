export interface VaultRelativePathOptions {
  allowRelative?: boolean;
}

export function vaultRelativePath(vaultPath: string, path: string, options: VaultRelativePathOptions = {}): string | null {
  const normalizedPath = normalizeFilePath(path);
  const normalizedVaultPath = normalizeFilePath(vaultPath);
  if (!normalizedPath || !normalizedVaultPath) return null;

  if (!isFilesystemAbsolutePath(normalizedPath)) return options.allowRelative === true ? normalizedPath : null;
  if (pathsEqual(normalizedPath, normalizedVaultPath)) return null;

  const vaultPrefix = normalizedVaultPath.endsWith("/") ? normalizedVaultPath : `${normalizedVaultPath}/`;
  return pathStartsWith(normalizedPath, vaultPrefix) ? normalizedPath.slice(vaultPrefix.length) : null;
}

export function pathRelativeToRoot(path: string, root?: string | null): string {
  const normalizedPath = normalizeFilePath(path);
  const normalizedRoot = normalizeFilePath(root ?? "");
  if (!normalizedRoot) return normalizedPath;
  if (pathsEqual(normalizedPath, normalizedRoot)) return ".";
  return pathStartsWith(normalizedPath, `${normalizedRoot}/`) ? normalizedPath.slice(normalizedRoot.length + 1) : normalizedPath;
}

export function isFilesystemAbsolutePath(path: string): boolean {
  return path.startsWith("/") || isWindowsAbsolutePath(path);
}

export function isVaultConfigPath(path: string, configDir: string): boolean {
  const normalizedPath = normalizeFilePath(path);
  const normalizedConfigDir = normalizeFilePath(configDir);
  return pathsEqual(normalizedPath, normalizedConfigDir) || pathStartsWith(normalizedPath, `${normalizedConfigDir}/`);
}

export function normalizeFilePath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
  return normalized.replace(/^\.\//, "");
}

function isWindowsAbsolutePath(path: string): boolean {
  return /^[a-z]:[\\/]/i.test(path);
}

function pathsEqual(left: string, right: string): boolean {
  return isWindowsAbsolutePath(left) || isWindowsAbsolutePath(right) ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function pathStartsWith(path: string, prefix: string): boolean {
  return isWindowsAbsolutePath(path) || isWindowsAbsolutePath(prefix)
    ? path.toLowerCase().startsWith(prefix.toLowerCase())
    : path.startsWith(prefix);
}
