import type { App } from "obsidian";
import { parseLinktext } from "obsidian";

const MAX_SOURCE_PATH_LENGTH = 1024;
const MAX_WIKILINK_LENGTH = 1024;
const MAX_WIKILINKS = 16;

interface ResolveWikilinksInput {
  readonly sourcePath: string | null;
  readonly wikilinks: readonly string[];
}

export interface ResolveWikilinksResult {
  readonly schemaVersion: 1;
  readonly sourcePath: string | null;
  readonly untrustedDataNotice: string;
  readonly results: readonly ResolvedWikilink[];
}

interface ResolvedWikilink {
  readonly query: string;
  readonly status: "resolved" | "unresolved";
  readonly linkpath: string;
  readonly subpath: string;
  readonly displayText: string | null;
  readonly resolvedPath: string | null;
}

export function resolveObsidianWikilinks(app: App, argumentsValue: unknown): ResolveWikilinksResult {
  const input = parseInput(argumentsValue);
  return {
    schemaVersion: 1,
    sourcePath: input.sourcePath,
    untrustedDataNotice: "Resolved paths are derived from untrusted note link text. Read and assess file contents separately.",
    results: input.wikilinks.map((query) => resolveWikilink(app, input.sourcePath ?? "", query)),
  };
}

function parseInput(value: unknown): ResolveWikilinksInput {
  if (!isRecord(value)) throw new Error("resolve_wikilinks arguments must be an object.");
  const keys = Object.keys(value);
  if (keys.some((key) => key !== "sourcePath" && key !== "wikilinks")) {
    throw new Error("resolve_wikilinks arguments contain an unsupported property.");
  }
  const sourcePath = value["sourcePath"];
  if (
    sourcePath !== undefined &&
    (typeof sourcePath !== "string" || sourcePath.trim().length === 0 || sourcePath.length > MAX_SOURCE_PATH_LENGTH)
  ) {
    throw new Error("sourcePath must be omitted or a non-empty string of at most 1024 characters.");
  }
  const wikilinks = value["wikilinks"];
  if (!Array.isArray(wikilinks) || wikilinks.length === 0 || wikilinks.length > MAX_WIKILINKS) {
    throw new Error("wikilinks must contain between 1 and 16 items.");
  }
  if (wikilinks.some((item) => typeof item !== "string" || item.length > MAX_WIKILINK_LENGTH)) {
    throw new Error("Each wikilink must be a string of at most 1024 characters.");
  }
  return { sourcePath: typeof sourcePath === "string" ? sourcePath.trim() : null, wikilinks };
}

function resolveWikilink(app: App, sourcePath: string, value: string): ResolvedWikilink {
  const query = value.trim();
  if (query.startsWith("![[")) throw new Error(`Embeds are not supported: ${query}`);
  if (!query.startsWith("[[") || !query.endsWith("]]")) throw new Error(`Invalid raw wikilink: ${query}`);

  const body = query.slice(2, -2);
  const aliasAt = body.indexOf("|");
  const linktext = (aliasAt === -1 ? body : body.slice(0, aliasAt)).trim();
  const displayText = aliasAt === -1 ? null : body.slice(aliasAt + 1).trim();
  if (!linktext) throw new Error(`Wikilink target must not be empty: ${query}`);

  const { path: linkpath, subpath } = parseLinktext(linktext);
  if (!linkpath.trim()) throw new Error(`Wikilink file target must not be empty: ${query}`);
  const destination = app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
  return {
    query,
    status: destination ? "resolved" : "unresolved",
    linkpath,
    subpath,
    displayText,
    resolvedPath: destination?.path ?? null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
