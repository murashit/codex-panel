export function normalizedUniqueTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalizedTags: string[] = [];
  for (const tag of tags) {
    const normalized = normalizeTag(tag);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    normalizedTags.push(normalized);
  }
  return normalizedTags.sort((a, b) => a.localeCompare(b));
}

export function normalizeTag(tag: string): string {
  return tag.trim().replace(/^#+/, "");
}
