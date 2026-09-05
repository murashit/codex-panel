import { type ThreadTitleContext, threadTitleContextFromTurnTranscriptSummary } from "../../../domain/threads/title-context";
import type { TurnTranscriptSummary } from "../../../domain/threads/transcript";
import type { ThreadTitlePort } from "./ports";

export interface ThreadTitleServiceHost {
  port: ThreadTitlePort;
  visibleContext?(threadId: string): ThreadTitleContext | null;
  visibleCompletedTurnContext?(turnId: string): ThreadTitleContext | null;
}

export interface ThreadTitleService {
  invalidate(): void;
  resolveContext(threadId: string): Promise<ThreadTitleContext | null>;
  completedTurnContext(turnId: string, completedTurnTranscriptSummary: TurnTranscriptSummary | null): ThreadTitleContext | null;
  generate(context: ThreadTitleContext, signal?: AbortSignal): Promise<string | null>;
}

export function createThreadTitleService(host: ThreadTitleServiceHost): ThreadTitleService {
  let controller = new AbortController();

  return {
    invalidate() {
      controller.abort();
      controller = new AbortController();
    },
    generate: async (context, signal) => {
      const operation = linkedAbortSignal(controller.signal, signal);
      try {
        return await generateTitleFromContext(host, context, operation.signal);
      } finally {
        operation.dispose();
      }
    },
    resolveContext: (threadId) => resolveThreadTitleContext(host, threadId),
    completedTurnContext: (turnId, completedTurnTranscriptSummary) => completedTurnContext(host, turnId, completedTurnTranscriptSummary),
  };
}

function linkedAbortSignal(
  ownerSignal: AbortSignal,
  operationSignal: AbortSignal | undefined,
): {
  signal: AbortSignal;
  dispose(): void;
} {
  if (!operationSignal) return { signal: ownerSignal, dispose: () => undefined };

  const controller = new AbortController();
  const abort = (): void => {
    controller.abort();
  };
  ownerSignal.addEventListener("abort", abort, { once: true });
  operationSignal.addEventListener("abort", abort, { once: true });
  if (ownerSignal.aborted || operationSignal.aborted) abort();
  return {
    signal: controller.signal,
    dispose: () => {
      ownerSignal.removeEventListener("abort", abort);
      operationSignal.removeEventListener("abort", abort);
    },
  };
}

async function resolveThreadTitleContext(host: ThreadTitleServiceHost, threadId: string): Promise<ThreadTitleContext | null> {
  const visibleContext = host.visibleContext?.(threadId);
  if (visibleContext) return visibleContext;
  return host.port.persistedContext(threadId);
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

async function generateTitleFromContext(
  host: ThreadTitleServiceHost,
  context: ThreadTitleContext,
  signal: AbortSignal,
): Promise<string | null> {
  throwIfTitleGenerationCancelled(signal);
  const title = await host.port.generateTitle(context, signal);
  throwIfTitleGenerationCancelled(signal);
  return title;
}

function throwIfTitleGenerationCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("Thread title generation cancelled.");
}
