import type { ThreadNamingContext } from "../../domain/threads/naming";
import { truncate } from "../../utils";
import { isCompletedTurnOutcomeMessage } from "./display/turn-outcome-message";
import type { DisplayItem } from "./display/types";

const MAX_CONTEXT_CHARS = 4_000;

export function namingContextFromDisplayItems(turnId: string, items: readonly DisplayItem[]): ThreadNamingContext | null {
  const turnItems = items.filter((item) => item.turnId === turnId);
  const userRequest =
    turnItems.find((item) => item.kind === "message" && item.role === "user")?.text.trim() ??
    precedingUnscopedUserMessage(turnId, items)?.text.trim() ??
    "";
  const assistantResponse = [...turnItems].reverse().find(isCompletedTurnOutcomeMessage)?.text.trim() ?? "";
  if (!userRequest || !assistantResponse) return null;
  return {
    userRequest: truncateForPrompt(userRequest),
    assistantResponse: truncateForPrompt(assistantResponse),
  };
}

export function firstNamingContextFromDisplayItems(items: readonly DisplayItem[]): ThreadNamingContext | null {
  const turnIds = new Set<string>();
  for (const item of items) {
    if (!item.turnId || turnIds.has(item.turnId)) continue;
    turnIds.add(item.turnId);
    const context = namingContextFromDisplayItems(item.turnId, items);
    if (context) return context;
  }
  return null;
}

function precedingUnscopedUserMessage(turnId: string, items: readonly DisplayItem[]): DisplayItem | null {
  const firstTurnItemIndex = items.findIndex((item) => item.turnId === turnId);
  if (firstTurnItemIndex < 1) return null;
  for (let index = firstTurnItemIndex - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!item || item.turnId) return null;
    if (item.kind === "message" && item.role === "user") return item;
  }
  return null;
}

function truncateForPrompt(text: string): string {
  return truncate(text.replace(/\s+/g, " ").trim(), MAX_CONTEXT_CHARS);
}
