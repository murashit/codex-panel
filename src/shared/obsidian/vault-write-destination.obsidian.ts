import { normalizePath, type Vault } from "obsidian";

import type { VaultMarkdownDestination, VaultPathDestination } from "../../domain/vault/write-paths";

export function createObsidianVaultPathDestination(vault: Vault): VaultPathDestination {
  return {
    writeLockKey: vault,
    normalizePath,
    exists: async (path: string): Promise<boolean> => vault.getAbstractFileByPath(normalizePath(path)) !== null,
    createFolder: async (path: string): Promise<void> => {
      await vault.createFolder(normalizePath(path));
    },
  };
}

export function createObsidianVaultMarkdownDestination(vault: Vault): VaultMarkdownDestination {
  return {
    ...createObsidianVaultPathDestination(vault),
    createMarkdownFile: async (path: string, content: string): Promise<void> => {
      await vault.create(normalizePath(path), content);
    },
  };
}
