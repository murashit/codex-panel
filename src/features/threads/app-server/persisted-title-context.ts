import type { AppServerRequestClient } from "../../../app-server/services/request-client";
import { readCompletedTurnTranscriptSummariesPage } from "../../../app-server/services/threads";
import { type ThreadTitleContext, threadTitleContextFromTurnTranscriptSummary } from "../../../domain/threads/title-context";

const DEFAULT_CONTEXT_PAGE_LIMIT = 20;
const DEFAULT_CONTEXT_MAX_PAGES = 5;

export async function readPersistedTitleContext(client: AppServerRequestClient, threadId: string): Promise<ThreadTitleContext | null> {
  let cursor: string | null = null;

  for (let page = 0; page < DEFAULT_CONTEXT_MAX_PAGES; page += 1) {
    const response = await readCompletedTurnTranscriptSummariesPage(client, threadId, cursor, DEFAULT_CONTEXT_PAGE_LIMIT, "asc");
    for (const summary of response.summaries) {
      const context = threadTitleContextFromTurnTranscriptSummary(summary);
      if (context) return context;
    }
    if (!response.nextCursor) break;
    cursor = response.nextCursor;
  }

  return null;
}
