import { type App, FileSystemAdapter } from "obsidian";

export function getVaultPath(app: App): string {
  const adapter = app.vault.adapter;
  if (adapter instanceof FileSystemAdapter) {
    const basePath = adapter.getBasePath();
    if (basePath.length > 0) return basePath;
  }
  throw new Error("This plugin requires a desktop vault with a local basePath.");
}
