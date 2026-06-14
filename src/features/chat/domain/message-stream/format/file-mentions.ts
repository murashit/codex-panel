import type { CodexInputItem } from "../../../../../domain/chat/input";
import type { MessageStreamFileMention } from "../items";

export function fileMentionsFromInput(input: readonly CodexInputItem[]): MessageStreamFileMention[] {
  const seen = new Set<string>();
  const mentions: MessageStreamFileMention[] = [];
  for (const item of input) {
    if (item.type !== "mention" || seen.has(item.path)) continue;
    seen.add(item.path);
    mentions.push({ name: item.name, path: item.path });
  }
  return mentions;
}
