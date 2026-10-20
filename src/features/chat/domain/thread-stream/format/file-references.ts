import { ACTIVE_FILE_REFERENCE_NAME, type CodexInputItem } from "../../../../../domain/input/input";
import type { ThreadStreamFileReference } from "../items";

const ACTIVE_FILE_DISPLAY_NAME = "Active file";

export function fileReferencesFromInput(input: readonly CodexInputItem[]): ThreadStreamFileReference[] {
  const seenFilePaths = new Set<string>();
  const seenActiveNotePaths = new Set<string>();
  const fileReferences: ThreadStreamFileReference[] = [];
  for (const reference of input) {
    if (reference.type !== "fileReference") continue;
    const activeFileReference = reference.name === ACTIVE_FILE_REFERENCE_NAME;
    const seen = activeFileReference ? seenActiveNotePaths : seenFilePaths;
    if (seen.has(reference.path)) continue;
    seen.add(reference.path);
    fileReferences.push({ name: activeFileReference ? ACTIVE_FILE_DISPLAY_NAME : reference.name, path: reference.path });
  }
  return fileReferences;
}
