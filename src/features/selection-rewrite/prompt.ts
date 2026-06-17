import { selectionRewriteTextRangeOffsets, type SelectionRewriteState } from "./model";

const MAX_NOTE_CONTEXT_CHARS = 20_000;

export const SELECTION_REWRITE_SERVICE_NAME = "codex-panel-rewrite-selection";

export const SELECTION_REWRITE_DEVELOPER_INSTRUCTIONS = [
  "You rewrite selected Obsidian note text.",
  "Return only JSON matching the requested schema.",
  "Do not include Markdown fences, explanations, alternatives, or comments outside JSON.",
  "The only editable target is the selected text. Use any provided note context only for consistency.",
  "Preserve Obsidian-specific syntax such as wikilinks, block ids, callouts, frontmatter-like text, and Dataview blocks unless the user's instruction explicitly asks to change them.",
].join("\n");

export function buildSelectionRewritePrompt(state: SelectionRewriteState): string {
  return [
    "Rewrite the selected text according to the user's instruction.",
    "",
    "Rules:",
    "- Return a JSON object with exactly one field: replacementText.",
    "- replacementText must be the full replacement for the selected text.",
    "- Do not edit outside the selected text.",
    "- Preserve the language and style of the surrounding note unless instructed otherwise.",
    "",
    "Target:",
    `- File: ${state.filePath}`,
    `- Selection: ${positionLabel(state.targetRange.from)} to ${positionLabel(state.targetRange.to)}`,
    "- Context mode: Selection + note context",
    "",
    "User instruction:",
    state.instruction,
    "",
    "Selected text:",
    fenced(state.originalText),
    "",
    "Current note context:",
    fenced(selectionCenteredNoteContext(state)),
    "",
    "Reminder: use the note context only to make the selected-text replacement coherent.",
  ].join("\n");
}

function positionLabel(position: { line: number; ch: number }): string {
  return `L${String(position.line + 1)}:C${String(position.ch + 1)}`;
}

function fenced(text: string): string {
  const fence = safeBacktickFence(text);
  return [`${fence}text`, text, fence].join("\n");
}

function safeBacktickFence(text: string): string {
  const longestRun = Math.max(2, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length));
  return "`".repeat(longestRun + 1);
}

function selectionCenteredNoteContext(state: SelectionRewriteState): string {
  const text = state.noteText;
  if (text.length <= MAX_NOTE_CONTEXT_CHARS) return text;

  const offsets = selectionRewriteTextRangeOffsets(text, state.targetRange, state.originalText);
  if (!offsets) return `${text.slice(0, MAX_NOTE_CONTEXT_CHARS - 1)}…`;

  const prefix = offsets.from > 0 ? "…\n" : "";
  const suffix = offsets.to < text.length ? "\n…" : "";
  const bodyBudget = MAX_NOTE_CONTEXT_CHARS - prefix.length - suffix.length;
  const selectedLength = Math.max(0, offsets.to - offsets.from);
  if (selectedLength >= bodyBudget) {
    const end = Math.min(text.length, offsets.from + bodyBudget);
    return `${offsets.from > 0 ? prefix : ""}${text.slice(offsets.from, end)}${end < text.length ? suffix : ""}`;
  }

  const surroundingBudget = Math.max(0, bodyBudget - selectedLength);
  let start = Math.max(0, offsets.from - Math.floor(surroundingBudget / 2));
  let end = Math.min(text.length, offsets.to + Math.ceil(surroundingBudget / 2));

  const currentLength = end - start;
  if (currentLength < bodyBudget) {
    const missing = bodyBudget - currentLength;
    start = Math.max(0, start - missing);
    end = Math.min(text.length, end + (bodyBudget - (end - start)));
  }

  return `${start > 0 ? prefix : ""}${text.slice(start, end)}${end < text.length ? suffix : ""}`;
}
