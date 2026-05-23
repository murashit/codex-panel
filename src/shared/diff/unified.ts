export interface DisplayDiffLine {
  text: string;
  kind?: "file";
}

export type DiffLineClass = "added" | "removed" | "hunk" | "context" | "file";

export function displayDiffLines(diff: string): DisplayDiffLine[] {
  const displayLines: DisplayDiffLine[] = [];
  let inFileHeader = false;
  for (const line of diff.split("\n")) {
    const file = filePathFromGitDiffHeader(line);
    if (file) {
      displayLines.push({ text: file, kind: "file" });
      inFileHeader = true;
      continue;
    }
    if (line.startsWith("@@")) inFileHeader = false;
    if (inFileHeader && (line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ "))) continue;
    displayLines.push({ text: line });
  }
  return displayLines;
}

export function diffLineClass(line: DisplayDiffLine): DiffLineClass {
  if (line.kind === "file") return "file";
  return diffLineClassFromText(line.text);
}

export function diffLineClassFromText(text: string): Exclude<DiffLineClass, "file"> {
  if (text.startsWith("+") && !text.startsWith("+++")) return "added";
  if (text.startsWith("-") && !text.startsWith("---")) return "removed";
  if (text.startsWith("@@")) return "hunk";
  return "context";
}

export function displayDiffLineText(text: string, lineClass: DiffLineClass): string {
  const displayText = lineClass === "added" || lineClass === "removed" ? text.slice(1) : text;
  return displayText || " ";
}

function filePathFromGitDiffHeader(line: string): string | null {
  const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
  if (!match) return null;
  return match[2] ?? null;
}
