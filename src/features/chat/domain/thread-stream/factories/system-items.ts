import type { SystemThreadStreamItem, ThreadStreamNoticeSection } from "../items";

export function createSystemItem(id: string, text: string): SystemThreadStreamItem {
  return {
    id,
    kind: "system",
    role: "system",
    text,
    provenance: { source: "panel", channel: "notice", reason: "system", sourceId: id },
  };
}

export function createStructuredSystemItem(id: string, text: string, noticeSections: ThreadStreamNoticeSection[]): SystemThreadStreamItem {
  return {
    id,
    kind: "system",
    role: "system",
    text,
    provenance: { source: "panel", channel: "notice", reason: "system", sourceId: id },
    noticeSections,
  };
}
