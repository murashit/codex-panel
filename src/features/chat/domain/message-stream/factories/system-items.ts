import type { MessageStreamItem, MessageStreamNoticeSection } from "../items";

export function createSystemItem(id: string, text: string): MessageStreamItem {
  return {
    id,
    kind: "system",
    role: "system",
    text,
    provenance: { source: "panel", channel: "notice", reason: "system", sourceId: id },
  };
}

export function createStructuredSystemItem(id: string, text: string, noticeSections: MessageStreamNoticeSection[]): MessageStreamItem {
  return {
    id,
    kind: "system",
    role: "system",
    text,
    provenance: { source: "panel", channel: "notice", reason: "system", sourceId: id },
    noticeSections,
  };
}
