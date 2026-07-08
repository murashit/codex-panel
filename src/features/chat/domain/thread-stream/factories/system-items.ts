import type { ThreadStreamItem, ThreadStreamNoticeSection } from "../items";

export function createSystemItem(id: string, text: string): ThreadStreamItem {
  return {
    id,
    kind: "system",
    role: "system",
    text,
    provenance: { source: "panel", channel: "notice", reason: "system", sourceId: id },
  };
}

export function createStructuredSystemItem(id: string, text: string, noticeSections: ThreadStreamNoticeSection[]): ThreadStreamItem {
  return {
    id,
    kind: "system",
    role: "system",
    text,
    provenance: { source: "panel", channel: "notice", reason: "system", sourceId: id },
    noticeSections,
  };
}
