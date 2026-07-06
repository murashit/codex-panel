import type { Vault } from "obsidian";
import { createObsidianVaultMarkdownDestination } from "../../../shared/obsidian/vault-write-destination.obsidian";
import type { ArchiveExportDestination } from "../workflows/archive-export";

export function createObsidianArchiveExportDestination(vault: Vault): ArchiveExportDestination {
  return createObsidianVaultMarkdownDestination(vault);
}
