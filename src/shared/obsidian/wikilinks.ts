import { parseLinktext } from "obsidian";

export interface ParsedObsidianWikiLink {
  target: string;
  subpath: string;
  display: string;
}

export function parseObsidianWikiLink(raw: string): ParsedObsidianWikiLink | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const separator = trimmed.indexOf("|");
  const linktext = (separator === -1 ? trimmed : trimmed.slice(0, separator)).trim();
  const display = separator === -1 ? "" : trimmed.slice(separator + 1).trim();
  if (!linktext) return null;

  const parsed = parseLinktext(linktext);
  const target = parsed.path.trim();
  const subpath = parsed.subpath.trim();
  if (!target) return null;
  return { target, subpath, display };
}
