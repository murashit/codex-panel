import { ACTIVE_FILE_MENTION_NAME, type CodexInputItem } from "../../../../../domain/chat/input";
import type { MessageStreamFileMention } from "../items";

const ACTIVE_FILE_DISPLAY_NAME = "Active file";

export function fileMentionsFromInput(input: readonly CodexInputItem[]): MessageStreamFileMention[] {
  const seenFilePaths = new Set<string>();
  const seenActiveNotePaths = new Set<string>();
  const mentions: MessageStreamFileMention[] = [];
  for (const item of input) {
    if (item.type !== "mention") continue;
    const activeNoteMention = item.name === ACTIVE_FILE_MENTION_NAME;
    const seen = activeNoteMention ? seenActiveNotePaths : seenFilePaths;
    if (seen.has(item.path)) continue;
    seen.add(item.path);
    mentions.push({ name: activeNoteMention ? ACTIVE_FILE_DISPLAY_NAME : item.name, path: item.path });
  }
  return mentions;
}
