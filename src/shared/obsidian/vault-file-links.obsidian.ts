import { type App, TFile } from "obsidian";

import { vaultRelativeFileHref } from "../../domain/vault/file-hrefs";

export function vaultFileLinkTarget(app: App, vaultPath: string, href: string): string | null {
  const relativePath = vaultRelativeFileHref(vaultPath, app.vault.configDir, href);
  if (!relativePath) return null;

  const abstractFile = app.vault.getAbstractFileByPath(relativePath.path);
  return abstractFile instanceof TFile ? `${relativePath.path}${relativePath.subpath}` : null;
}
