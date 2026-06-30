export interface VaultRelativePathOptions {
  allowRelative?: boolean;
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

function isWindowsAbsolutePath(path: string): boolean {
  return /^[a-z]:[\\/]/i.test(path);
}
