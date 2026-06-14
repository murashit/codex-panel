import type { ThreadTitleContext } from "../../../../domain/threads/title-generation-model";
import { truncate } from "../../../../utils";
import { isCompletedTurnOutcomeMessage } from "../../domain/message-stream/selectors";
import type { MessageStreamItem, MessageStreamMessageItem } from "../../domain/message-stream/items";

const MAX_CONTEXT_CHARS = 4_000;

export function threadTitleContextFromMessageStreamItems(turnId: string, items: readonly MessageStreamItem[]): ThreadTitleContext | null {
  const turnItems = items.filter((item) => item.turnId === turnId);
  const userRequest =
    turnItems.find((item) => item.kind === "message" && item.role === "user")?.text.trim() ??
    precedingUnscopedTitleSeed(turnId, items) ??
    "";
  const assistantResponse =
    [...turnItems]
      .reverse()
      .find((item): item is MessageStreamMessageItem => item.kind === "message" && isCompletedTurnOutcomeMessage(item))
      ?.text.trim() ?? "";
  if (!userRequest || !assistantResponse) return null;
  return {
    userRequest: truncateForPrompt(userRequest),
    assistantResponse: truncateForPrompt(assistantResponse),
  };
}

export function firstThreadTitleContextFromMessageStreamItems(items: readonly MessageStreamItem[]): ThreadTitleContext | null {
  const turnIds = new Set<string>();
  for (const item of items) {
    if (!item.turnId || turnIds.has(item.turnId)) continue;
    turnIds.add(item.turnId);
    const context = threadTitleContextFromMessageStreamItems(item.turnId, items);
    if (context) return context;
  }
  return null;
}

function precedingUnscopedTitleSeed(turnId: string, items: readonly MessageStreamItem[]): string | null {
  const firstTurnItemIndex = items.findIndex((item) => item.turnId === turnId);
  if (firstTurnItemIndex < 1) return null;
  for (let index = firstTurnItemIndex - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!item || item.turnId) return null;
    if (item.kind === "message" && item.role === "user") return item.text.trim();
    if (item.kind === "goal" && item.objective) return item.objective.trim();
  }
  return null;
}

function truncateForPrompt(text: string): string {
  return truncate(text.replace(/\s+/g, " ").trim(), MAX_CONTEXT_CHARS);
}
