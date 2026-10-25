import { formatComposerContextRange, type SelectionContextReference, type SelectionContextSnapshot } from "./context-references";

const PREVIEW_LENGTH = 48;

export function selectionContextPreview(selection: SelectionContextReference, length = PREVIEW_LENGTH): string {
  return previewForNote(selection.linktext, selection.text, length);
}

function previewText(text: string): string {
  return text.replace(/\r\n|[\r\n\t\u2028\u2029]/g, " ");
}

function previewForNote(linktext: string, text: string, length: number, coordinates = ""): string {
  const characters = Array.from(previewText(text));
  const preview = characters.slice(0, length).join("") + (characters.length > length ? "…" : "");
  return `[[${linktext}]] ${coordinates}"${preview}"`;
}

export function captureSelectionContext(
  reference: SelectionContextReference,
  reserved: readonly SelectionContextSnapshot[],
): SelectionContextSnapshot {
  const sameText = reserved.filter((snapshot) => snapshot.reference.path === reference.path && snapshot.reference.text === reference.text);
  const existing = sameText.find(
    (snapshot) =>
      reference.range === null ||
      (snapshot.reference.range !== null &&
        formatComposerContextRange(snapshot.reference.range) === formatComposerContextRange(reference.range)),
  );
  if (existing) return existing;

  const coordinates = reference.range !== null && sameText.length > 0 ? `(${formatComposerContextRange(reference.range)}) ` : "";
  const occupied = reserved.map((snapshot) => snapshot.marker);
  // Do not allocate a label that extends another reserved label, or vice versa.
  const available = (marker: string): boolean => !occupied.some((other) => marker.startsWith(other) || other.startsWith(marker));
  const length = Array.from(previewText(reference.text)).length;
  const first = Math.min(PREVIEW_LENGTH, length);
  // Use the actual note path if the shorter name leaves no usable label.
  for (const linktext of new Set([reference.linktext, reference.path.replace(/\.md$/i, ""), reference.path])) {
    for (let size = first; size <= length; size += 1) {
      const marker = previewForNote(linktext, reference.text, size, coordinates);
      if (available(marker)) return { reference, marker };
    }
    // If extending cannot distinguish the new label, keep a shorter honest excerpt.
    for (let size = first - 1; size > 0; size -= 1) {
      const marker = previewForNote(linktext, reference.text, size, coordinates);
      if (available(marker)) return { reference, marker };
    }
  }
  throw new Error("No distinct selection preview available.");
}

export function selectionContextMatches(text: string, snapshots: readonly SelectionContextSnapshot[]) {
  const matches: { snapshot: SelectionContextSnapshot; start: number; end: number }[] = [];
  const ordered = [...snapshots].sort((a, b) => b.marker.length - a.marker.length);
  let cursor = 0;
  while (cursor < text.length) {
    let next: (typeof matches)[number] | null = null;
    for (const snapshot of ordered) {
      const start = text.indexOf(snapshot.marker, cursor);
      if (start >= 0 && (!next || start < next.start)) next = { snapshot, start, end: start + snapshot.marker.length };
    }
    if (!next) break;
    matches.push(next);
    cursor = next.end;
  }
  let masked = "";
  cursor = 0;
  for (const match of matches) {
    masked += text.slice(cursor, match.start) + "x".repeat(match.end - match.start);
    cursor = match.end;
  }
  masked += text.slice(cursor);
  // Treat excerpt syntax as text, not new wikilinks, skills, or code delimiters.
  return { matches, masked };
}
