import type { MessageStreamDetailSection, MessageStreamItem } from "../../message-stream/items";

export function createSystemItem(id: string, text: string): MessageStreamItem {
  return {
    id,
    kind: "system",
    role: "system",
    text,
  };
}

export function createStructuredSystemItem(id: string, text: string, details: MessageStreamDetailSection[]): MessageStreamItem {
  return {
    id,
    kind: "system",
    role: "system",
    text,
    details,
  };
}
