import type { AppServerClientAccess } from "../../app-server/connection/client-access";
import { generateThreadTitleWithCodex } from "../../app-server/services/thread-title-generation";
import { readCompletedConversationSummariesPage } from "../../app-server/threads";
import type { ReasoningEffort } from "../../domain/catalog/metadata";
import {
  findThreadTitleContext,
  THREAD_TITLE_CONTEXT_UNAVAILABLE_MESSAGE,
  type ThreadTitleContext,
  threadTitleContextFromConversationSummary,
} from "../../domain/threads/title-generation-model";
import type { ThreadConversationSummary } from "../../domain/threads/transcript";

export interface ThreadTitleServiceHost {
  codexPath: () => string;
  vaultPath: string;
  threadNamingModel: () => string | null;
  threadNamingEffort: () => ReasoningEffort | null;
  clientAccess: AppServerClientAccess;
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
  const visibleContext = host.visibleContext?.(threadId);
  if (visibleContext) return visibleContext;
  return persistedThreadTitleContext(host, threadId);
}

async function persistedThreadTitleContext(host: ThreadTitleServiceHost, threadId: string): Promise<ThreadTitleContext | null> {
  return host.clientAccess.withClient((client) =>
    findThreadTitleContext({
      threadId,
      readTurns: (id, cursor, limit, sortDirection) => readCompletedConversationSummariesPage(client, id, cursor, limit, sortDirection),
    }),
  );
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
  return generateThreadTitleWithCodex(host.codexPath(), host.vaultPath, context, {
    threadNamingModel: host.threadNamingModel(),
    threadNamingEffort: host.threadNamingEffort(),
  });
}
