import { ACTIVE_FILE_REFERENCE_NAME, type CodexInputItem, type VaultFileReference } from "../../../../../domain/turns/input";
import type { ThreadStreamFileReference } from "../items";

const ACTIVE_FILE_DISPLAY_NAME = "Active file";

export function fileReferencesFromInput(input: readonly CodexInputItem[]): ThreadStreamFileReference[] {
  return threadStreamFileReferences(input.flatMap((item) => (item.type === "fileReference" ? [{ name: item.name, path: item.path }] : [])));
}

export function threadStreamFileReferences(references: readonly VaultFileReference[]): ThreadStreamFileReference[] {
  const seenFilePaths = new Set<string>();
  const seenActiveNotePaths = new Set<string>();
  const fileReferences: ThreadStreamFileReference[] = [];
  for (const reference of references) {
    const activeFileReference = reference.name === ACTIVE_FILE_REFERENCE_NAME;
    const seen = activeFileReference ? seenActiveNotePaths : seenFilePaths;
    if (seen.has(reference.path)) continue;
    seen.add(reference.path);
    fileReferences.push({ name: activeFileReference ? ACTIVE_FILE_DISPLAY_NAME : reference.name, path: reference.path });
  }
  return fileReferences;
}
