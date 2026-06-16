import type { AppServerClient } from "../../app-server/connection/client";
import { generateThreadTitleWithCodex } from "../../app-server/services/thread-title-generation";
import { readCompletedConversationSummariesPage } from "../../app-server/threads/data";
import type { ThreadConversationSummary } from "../../domain/threads/transcript";
import {
  findThreadTitleContext,
  THREAD_TITLE_CONTEXT_UNAVAILABLE_MESSAGE,
  threadTitleContextFromConversationSummary,
  type ThreadTitleContext,
} from "../../domain/threads/title-generation-model";
import type { CodexPanelSettings } from "../../settings/model";

export interface ThreadTitleServiceHost {
  settings: {
    current(): CodexPanelSettings;
    vaultPath: string;
  };
  currentClient(): AppServerClient | null;
  visibleContext?(threadId: string): ThreadTitleContext | null;
  visibleCompletedTurnContext?(turnId: string): ThreadTitleContext | null;
  generateThreadTitle?(context: ThreadTitleContext): Promise<string | null>;
}

export interface ThreadTitleService {
  generateTitle(threadId: string): Promise<string>;
  resolveContext(threadId: string): Promise<ThreadTitleContext | null>;
  completedTurnContext(turnId: string, completedSummary: ThreadConversationSummary | null): ThreadTitleContext | null;
  generate(context: ThreadTitleContext): Promise<string | null>;
}

export function createThreadTitleService(host: ThreadTitleServiceHost): ThreadTitleService {
  return {
    generateTitle: (threadId) => generateTitle(host, threadId),
    resolveContext: (threadId) => resolveThreadTitleContext(host, threadId),
    completedTurnContext: (turnId, completedSummary) => completedTurnContext(host, turnId, completedSummary),
    generate: (context) => generateTitleFromContext(host, context),
  };
}

async function generateTitle(host: ThreadTitleServiceHost, threadId: string): Promise<string> {
  const context = await resolveThreadTitleContext(host, threadId);
  if (!context) throw new Error(THREAD_TITLE_CONTEXT_UNAVAILABLE_MESSAGE);

  const title = await generateTitleFromContext(host, context);
  if (!title) throw new Error("Codex did not return a usable thread title.");
  return title;
}

async function resolveThreadTitleContext(host: ThreadTitleServiceHost, threadId: string): Promise<ThreadTitleContext | null> {
  const client = host.currentClient();
  const persistedContext = client
    ? await findThreadTitleContext({
        threadId,
        readTurns: (id, cursor, limit, sortDirection) => readCompletedConversationSummariesPage(client, id, cursor, limit, sortDirection),
      })
    : null;
  return persistedContext ?? host.visibleContext?.(threadId) ?? null;
}

function completedTurnContext(
  host: ThreadTitleServiceHost,
  turnId: string,
  completedSummary: ThreadConversationSummary | null,
): ThreadTitleContext | null {
  return (
    host.visibleCompletedTurnContext?.(turnId) ?? (completedSummary ? threadTitleContextFromConversationSummary(completedSummary) : null)
  );
}

async function generateTitleFromContext(host: ThreadTitleServiceHost, context: ThreadTitleContext): Promise<string | null> {
  if (host.generateThreadTitle) return host.generateThreadTitle(context);
  const settings = host.settings.current();
  return generateThreadTitleWithCodex(settings.codexPath, host.settings.vaultPath, context, {
    threadNamingModel: settings.threadNamingModel,
    threadNamingEffort: settings.threadNamingEffort,
  });
}
