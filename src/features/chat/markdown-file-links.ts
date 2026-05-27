import { TFile, type App } from "obsidian";

export function vaultFileLinkTarget(app: App, vaultPath: string, href: string): string | null {
  const relativePath = vaultRelativeFileHref(vaultPath, app.vault.configDir, href);
  if (!relativePath) return null;

  const abstractFile = app.vault.getAbstractFileByPath(relativePath.path);
  return abstractFile instanceof TFile ? `${relativePath.path}${relativePath.subpath}` : null;
}

export function vaultRelativeFileLinkTarget(vaultPath: string, configDir: string, href: string): string | null {
  const relativePath = vaultRelativeFileHref(vaultPath, configDir, href);
  return relativePath ? `${relativePath.path}${relativePath.subpath}` : null;
}

export function isAbsoluteFileHref(href: string): boolean {
  const parsed = parseFileHref(href);
  return parsed ? isAbsolutePath(normalizeFilePath(parsed.path)) : false;
}

function vaultRelativeFileHref(vaultPath: string, configDir: string, href: string): { path: string; subpath: string } | null {
  const parsed = parseFileHref(href);
  if (!parsed) return null;

  const relativePath = vaultRelativePath(vaultPath, parsed.path);
  if (!relativePath) return null;

  const normalized = normalizeFilePath(relativePath);
  if (isVaultConfigPath(normalized, configDir)) return null;

  return { path: normalized, subpath: parsed.subpath };
}

function parseFileHref(href: string): { path: string; subpath: string } | null {
  const trimmed = href.trim();
  if (!trimmed || isExternalHref(trimmed)) return null;

  const fragmentIndex = trimmed.indexOf("#");
  const withoutFragment = fragmentIndex === -1 ? trimmed : trimmed.slice(0, fragmentIndex);
  if (!withoutFragment) return null;

  const decoded = decodeHref(withoutFragment);
  const withoutLine = decoded.replace(/:(\d+)(?::\d+)?$/, "");
  const subpath = fragmentIndex === -1 ? "" : decodeHref(trimmed.slice(fragmentIndex));
  return withoutLine ? { path: withoutLine, subpath } : null;
}

function isExternalHref(href: string): boolean {
  if (isWindowsAbsolutePath(href)) return false;
  return /^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith("//");
}

function vaultRelativePath(vaultPath: string, path: string): string | null {
  const normalizedPath = normalizeFilePath(path);
  const normalizedVaultPath = normalizeFilePath(vaultPath);
  if (!normalizedPath || !normalizedVaultPath) return null;

  if (!isAbsolutePath(normalizedPath)) return normalizedPath;
  if (normalizedPath === normalizedVaultPath) return null;

  const vaultPrefix = normalizedVaultPath.endsWith("/") ? normalizedVaultPath : `${normalizedVaultPath}/`;
  return normalizedPath.startsWith(vaultPrefix) ? normalizedPath.slice(vaultPrefix.length) : null;
}

function decodeHref(href: string): string {
  try {
    return decodeURI(href);
  } catch {
    return href;
  }
}

function normalizeFilePath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
  return normalized.replace(/^\.\//, "");
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || isWindowsAbsolutePath(path);
}

function isWindowsAbsolutePath(path: string): boolean {
  return /^[a-z]:[\\/]/i.test(path);
}

function isVaultConfigPath(path: string, configDir: string): boolean {
  const normalizedConfigDir = normalizeFilePath(configDir);
  return path === normalizedConfigDir || path.startsWith(`${normalizedConfigDir}/`);
}
