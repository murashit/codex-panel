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

export class ThreadTitleService {
  constructor(private readonly host: ThreadTitleServiceHost) {}

  async generateTitle(threadId: string): Promise<string> {
    const context = await this.resolveContext(threadId);
    if (!context) throw new Error(THREAD_TITLE_CONTEXT_UNAVAILABLE_MESSAGE);

    const title = await this.generate(context);
    if (!title) throw new Error("Codex did not return a usable thread title.");
    return title;
  }

  async resolveContext(threadId: string): Promise<ThreadTitleContext | null> {
    const client = this.host.currentClient();
    const persistedContext = client
      ? await findThreadTitleContext({
          threadId,
          readTurns: (id, cursor, limit, sortDirection) => readCompletedConversationSummariesPage(client, id, cursor, limit, sortDirection),
        })
      : null;
    return persistedContext ?? this.host.visibleContext?.(threadId) ?? null;
  }

  completedTurnContext(turnId: string, completedSummary: ThreadConversationSummary | null): ThreadTitleContext | null {
    return (
      this.host.visibleCompletedTurnContext?.(turnId) ??
      (completedSummary ? threadTitleContextFromConversationSummary(completedSummary) : null)
    );
  }

  async generate(context: ThreadTitleContext): Promise<string | null> {
    if (this.host.generateThreadTitle) return this.host.generateThreadTitle(context);
    const settings = this.host.settings.current();
    return generateThreadTitleWithCodex(settings.codexPath, this.host.settings.vaultPath, context, {
      threadNamingModel: settings.threadNamingModel,
      threadNamingEffort: settings.threadNamingEffort,
    });
  }
}
