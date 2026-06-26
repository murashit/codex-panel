import { normalizePath, type Vault } from "obsidian";

export function createObsidianArchiveExportDestination(vault: Vault) {
  return {
    normalizePath,
    exists: async (path: string): Promise<boolean> => vault.getAbstractFileByPath(normalizePath(path)) !== null,
    createFolder: async (path: string): Promise<void> => {
      await vault.createFolder(normalizePath(path));
    },
    createMarkdownFile: async (path: string, content: string): Promise<void> => {
      await vault.create(normalizePath(path), content);
    },
  };
}
