type ReadPage<T> = (cursor: string | null) => Promise<{ data: readonly T[]; nextCursor?: string | null }>;

export async function* cursorPages<T>(readPage: ReadPage<T>, listName: string): AsyncGenerator<readonly T[]> {
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  for (;;) {
    const page = await readPage(cursor);
    yield page.data;
    cursor = page.nextCursor ?? null;
    if (!cursor) return;
    if (seenCursors.has(cursor)) throw new Error(`Codex app-server returned a repeated ${listName} cursor.`);
    seenCursors.add(cursor);
  }
}

export async function collectCursorPages<T>(readPage: ReadPage<T>, listName: string): Promise<T[]> {
  const items: T[] = [];
  for await (const page of cursorPages(readPage, listName)) items.push(...page);
  return items;
}
