import {
  THREAD_TITLE_CONTEXT_UNAVAILABLE_MESSAGE,
  type ThreadTitleContext,
  threadTitleContextFromTurnTranscriptSummary,
} from "../../../domain/threads/title-generation-model";
import type { TurnTranscriptSummary } from "../../../domain/threads/transcript";
import type { ThreadTitleTransport } from "./ports";

export interface ThreadTitleServiceHost {
  transport: ThreadTitleTransport;
  visibleContext?(threadId: string): ThreadTitleContext | null;
  visibleCompletedTurnContext?(turnId: string): ThreadTitleContext | null;
  generateThreadTitle?(context: ThreadTitleContext): Promise<string | null>;
}

export interface ThreadTitleService {
  generateTitle(threadId: string): Promise<string>;
  resolveContext(threadId: string): Promise<ThreadTitleContext | null>;
  completedTurnContext(turnId: string, completedTurnTranscriptSummary: TurnTranscriptSummary | null): ThreadTitleContext | null;
  generate(context: ThreadTitleContext): Promise<string | null>;
}

export function createThreadTitleService(host: ThreadTitleServiceHost): ThreadTitleService {
  return {
    generateTitle: (threadId) => generateTitle(host, threadId),
    resolveContext: (threadId) => resolveThreadTitleContext(host, threadId),
    completedTurnContext: (turnId, completedTurnTranscriptSummary) => completedTurnContext(host, turnId, completedTurnTranscriptSummary),
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
  return host.transport.persistedContext(threadId);
}

function completedTurnContext(
  host: ThreadTitleServiceHost,
  turnId: string,
  completedTurnTranscriptSummary: TurnTranscriptSummary | null,
): ThreadTitleContext | null {
  return (
    host.visibleCompletedTurnContext?.(turnId) ??
    (completedTurnTranscriptSummary ? threadTitleContextFromTurnTranscriptSummary(completedTurnTranscriptSummary) : null)
  );
}

async function generateTitleFromContext(host: ThreadTitleServiceHost, context: ThreadTitleContext): Promise<string | null> {
  return host.generateThreadTitle ? host.generateThreadTitle(context) : host.transport.generateTitle(context);
}
