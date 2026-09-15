export async function collectCursorPages<T>(
  readPage: (cursor: string | null) => Promise<{ data: readonly T[]; nextCursor?: string | null }>,
  listName: string,
): Promise<T[]> {
  const items: T[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  for (;;) {
    const page = await readPage(cursor);
    items.push(...page.data);
    cursor = page.nextCursor ?? null;
    if (!cursor) return items;
    if (seenCursors.has(cursor)) throw new Error(`Codex app-server returned a repeated ${listName} cursor.`);
    seenCursors.add(cursor);
  }
}
