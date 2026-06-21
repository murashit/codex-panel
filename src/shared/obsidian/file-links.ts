import { TFile, type App } from "obsidian";

import { isFilesystemAbsolutePath, isVaultConfigPath, normalizeFilePath, parseFileHref, vaultRelativePath } from "../path/file-paths";

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
  return parsed ? isFilesystemAbsolutePath(normalizeFilePath(parsed.path)) : false;
}

function vaultRelativeFileHref(vaultPath: string, configDir: string, href: string): { path: string; subpath: string } | null {
  const parsed = parseFileHref(href);
  if (!parsed) return null;

  const relativePath = vaultRelativePath(vaultPath, parsed.path, { allowRelative: true });
  if (!relativePath) return null;

  const normalized = normalizeFilePath(relativePath);
  if (isVaultConfigPath(normalized, configDir)) return null;

  return { path: normalized, subpath: parsed.subpath };
}
