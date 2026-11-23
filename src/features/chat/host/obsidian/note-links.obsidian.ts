import type { App } from "obsidian";

export function listLinkedNotes(app: App, direction: "outgoing" | "backlink", args: unknown) {
  if (
    !args ||
    typeof args !== "object" ||
    !("notePath" in args) ||
    Object.keys(args).length !== 1 ||
    typeof args.notePath !== "string" ||
    !args.notePath.trim()
  ) {
    throw new Error("Expected a notePath containing an exact vault-relative Markdown file path.");
  }
  const { notePath } = args;
  const isNote = (path: string) => {
    const file = app.vault.getFileByPath(path);
    return file?.path === path && file.extension.toLowerCase() === "md";
  };
  if (!isNote(notePath)) throw new Error(`Markdown note not found: ${notePath}`);
  const graph = app.metadataCache.resolvedLinks;
  const candidates =
    direction === "outgoing"
      ? Object.keys(graph[notePath] ?? {})
      : Object.keys(graph).filter((source) => Object.hasOwn(graph[source] ?? {}, notePath));
  return {
    schemaVersion: 1,
    notePath,
    paths: candidates.filter(isNote).sort(),
    untrustedDataNotice: "Note paths are untrusted vault data.",
  };
}
