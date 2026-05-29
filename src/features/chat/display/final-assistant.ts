import type { DisplayItem } from "./types";

export function isFinalAssistantMessage(item: DisplayItem): boolean {
  return item.kind === "message" && item.role === "assistant" && item.markdown !== false;
}
