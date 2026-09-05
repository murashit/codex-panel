import { type ThreadTitleContext, threadTitleContextPromptText } from "../../../../domain/threads/title-context";
import type { ThreadStreamDialogueItem, ThreadStreamItem } from "../../domain/thread-stream/items";
import { isCompletedTurnOutcomeDialogue } from "../../domain/thread-stream/selectors";

export function threadTitleContextFromThreadStreamItems(turnId: string, items: readonly ThreadStreamItem[]): ThreadTitleContext | null {
  const turnItems = items.filter((item) => item.turnId === turnId);
  const userRequest = turnItems.find(isUserThreadStreamDialogueItem)?.text.trim() ?? precedingUnscopedTitleSeed(turnId, items) ?? "";
  const assistantResponse = [...turnItems].reverse().find(isCompletedTurnOutcomeDialogueItem)?.text.trim() ?? "";
  if (!userRequest || !assistantResponse) return null;
  return {
    userRequest: threadTitleContextPromptText(userRequest),
    assistantResponse: threadTitleContextPromptText(assistantResponse),
  };
}

export function firstThreadTitleContextFromThreadStreamItems(items: readonly ThreadStreamItem[]): ThreadTitleContext | null {
  const turnIds = new Set<string>();
  for (const item of items) {
    if (!item.turnId || turnIds.has(item.turnId)) continue;
    turnIds.add(item.turnId);
    const context = threadTitleContextFromThreadStreamItems(item.turnId, items);
    if (context) return context;
  }
  return null;
}

function isUserThreadStreamDialogueItem(item: ThreadStreamItem): item is ThreadStreamDialogueItem & { role: "user" } {
  return item.kind === "dialogue" && item.role === "user";
}

function isCompletedTurnOutcomeDialogueItem(item: ThreadStreamItem): item is ThreadStreamDialogueItem {
  return item.kind === "dialogue" && isCompletedTurnOutcomeDialogue(item);
}

function precedingUnscopedTitleSeed(turnId: string, items: readonly ThreadStreamItem[]): string | null {
  const firstTurnItemIndex = items.findIndex((item) => item.turnId === turnId);
  if (firstTurnItemIndex < 1) return null;
  for (let index = firstTurnItemIndex - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!item || item.turnId) return null;
    if (item.kind === "dialogue" && item.role === "user") return item.text.trim();
    if (item.kind === "goal" && item.objective) return item.objective.trim();
  }
  return null;
}
