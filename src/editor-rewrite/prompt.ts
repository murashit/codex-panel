import type { RewriteSession } from "./model";

const MAX_NOTE_CONTEXT_CHARS = 20_000;

export const REWRITE_SERVICE_NAME = "codex-panel-rewrite-selection";

export const REWRITE_DEVELOPER_INSTRUCTIONS = [
  "You rewrite selected Obsidian note text.",
  "Return only JSON matching the requested schema.",
  "Do not include Markdown fences, explanations, alternatives, or comments outside JSON.",
  "The only editable target is the selected text. Use any provided note context only for consistency.",
  "Preserve Obsidian-specific syntax such as wikilinks, block ids, callouts, frontmatter-like text, and Dataview blocks unless the user's instruction explicitly asks to change them.",
].join("\n");

export function buildRewritePrompt(session: RewriteSession): string {
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
    `- File: ${session.filePath}`,
    `- Selection: ${positionLabel(session.targetRange.from)} to ${positionLabel(session.targetRange.to)}`,
    "- Context mode: Selection + note context",
    "",
    "User instruction:",
    session.instruction,
    "",
    "Selected text:",
    fenced(session.originalText),
    "",
    "Current note context:",
    fenced(truncateNoteContext(session.noteText)),
    "",
    "Reminder: use the note context only to make the selected-text replacement coherent.",
  ].join("\n");
}

function positionLabel(position: { line: number; ch: number }): string {
  return `L${position.line + 1}:C${position.ch + 1}`;
}

function fenced(text: string): string {
  return ["```text", text, "```"].join("\n");
}

function truncateNoteContext(text: string): string {
  if (text.length <= MAX_NOTE_CONTEXT_CHARS) return text;
  return `${text.slice(0, MAX_NOTE_CONTEXT_CHARS - 1)}…`;
}
