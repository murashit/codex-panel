export function normalizeProposedPlanMarkdown(text: string): string {
  return text
    .replace(/^\s*<proposed_plan>\s*\n?/i, "")
    .replace(/\n?\s*<\/proposed_plan>\s*$/i, "")
    .trim();
}
