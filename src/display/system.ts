import type { DisplayItem } from "./types";
import type { DisplayDetailSection } from "./types";

function systemId(): string {
  return `system-${String(Date.now())}-${Math.random().toString(36).slice(2)}`;
}

export function createSystemItem(text: string): DisplayItem {
  return {
    id: systemId(),
    kind: "system",
    role: "system",
    text,
  };
}

export function createStructuredSystemItem(text: string, details: DisplayDetailSection[]): DisplayItem {
  return {
    id: systemId(),
    kind: "system",
    role: "system",
    text,
    markdown: false,
    details,
  };
}
