import type { DisplayItem } from "./types";

export function createSystemItem(text: string): DisplayItem {
  return {
    id: `system-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    kind: "system",
    role: "system",
    text,
  };
}
