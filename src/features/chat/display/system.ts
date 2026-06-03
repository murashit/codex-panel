import type { DisplayItem } from "./types";
import type { DisplayDetailSection } from "./types";

export function createSystemItem(id: string, text: string): DisplayItem {
  return {
    id,
    kind: "system",
    role: "system",
    text,
  };
}

export function createStructuredSystemItem(id: string, text: string, details: DisplayDetailSection[]): DisplayItem {
  return {
    id,
    kind: "system",
    role: "system",
    text,
    details,
  };
}
