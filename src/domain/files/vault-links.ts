import { isFilesystemAbsolutePath, isVaultConfigPath, vaultRelativePath } from "./paths";

export interface ParsedFileHref {
  path: string;
  subpath: string;
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

function isExternalFileHref(href: string): boolean {
  if (/^[a-z]:[\\/]/i.test(href) || /^\\\\[^\\]/.test(href)) return false;
  return /^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith("//");
}

export function vaultRelativeFileLinkTarget(vaultPath: string, configDir: string, href: string): string | null {
  const relativePath = vaultRelativeFileHref(vaultPath, configDir, href);
  return relativePath ? `${relativePath.path}${relativePath.subpath}` : null;
}

export function isAbsoluteFileHref(href: string): boolean {
  const parsed = parseFileHref(href);
  return parsed ? isFilesystemAbsolutePath(parsed.path) : false;
}

export function vaultRelativeFileHref(vaultPath: string, configDir: string, href: string): { path: string; subpath: string } | null {
  const parsed = parseFileHref(href);
  if (!parsed) return null;

  const relativePath = vaultRelativePath(vaultPath, parsed.path, { allowRelative: true });
  if (!relativePath) return null;

  if (isVaultConfigPath(relativePath, configDir, vaultPath)) return null;

  return { path: relativePath, subpath: parsed.subpath };
}

function decodeFileHref(href: string): string {
  try {
    return decodeURI(href);
  } catch {
    return href;
  }
}
