import type { Thread } from "../../../../domain/threads/model";
import type { ThreadConversationSummary } from "../../../../domain/threads/transcript";
import type { ThreadTitleContext } from "../../../../domain/threads/title-generation-model";
import type { ThreadTitleService } from "../../../threads/thread-title-service";
import type { ChatState } from "../state/root-reducer";
import type { ChatStateStore } from "../state/store";

export interface AutoTitleControllerHost {
  stateStore: ChatStateStore;
  titleService: Pick<ThreadTitleService, "completedTurnContext" | "generate">;
  renameGeneratedTitle(threadId: string, title: string, options: { shouldPublish: () => boolean }): Promise<boolean>;
}

export class AutoTitleController {
  private activeThreadHadTurns = false;
  private readonly attemptedThreadIds = new Set<string>();
  private readonly inFlightThreadIds = new Set<string>();

  constructor(private readonly host: AutoTitleControllerHost) {}

  private get state(): ChatState {
    return this.host.stateStore.getState();
  }

  resetThreadTurnPresence(hadTurns: boolean): void {
    this.activeThreadHadTurns = hadTurns;
  }

  maybeAutoTitleThread(threadId: string, turnId: string, completedSummary: ThreadConversationSummary | null): void {
    const hadTurnsBeforeThisCompletion = this.activeThreadHadTurns;
    this.activeThreadHadTurns = true;

    if (hadTurnsBeforeThisCompletion) return;
    if (this.threadHasTitle(threadId)) return;
    if (this.attemptedThreadIds.has(threadId) || this.inFlightThreadIds.has(threadId)) return;
    const context = this.host.titleService.completedTurnContext(turnId, completedSummary);
    if (!context) return;

    this.attemptedThreadIds.add(threadId);
    this.inFlightThreadIds.add(threadId);
    void this.generateAndSetTitle(threadId, context);
  }

  private async generateAndSetTitle(threadId: string, context: ThreadTitleContext): Promise<void> {
    try {
      const title = await this.generateTitle(context);
      if (!title || !this.threadCanReceiveGeneratedTitle(threadId)) return;

      const renamed = await this.host.renameGeneratedTitle(threadId, title, {
        shouldPublish: () => this.threadCanReceiveGeneratedTitle(threadId),
      });
      if (!renamed) return;
    } catch {
      // Auto-title is best-effort metadata. Leave the thread preview untouched on failure.
    } finally {
      this.inFlightThreadIds.delete(threadId);
    }
  }

  private async generateTitle(context: ThreadTitleContext): Promise<string | null> {
    return this.host.titleService.generate(context);
  }

  private threadHasTitle(threadId: string): boolean {
    return Boolean(this.thread(threadId)?.name?.trim());
  }

  private threadCanReceiveGeneratedTitle(threadId: string): boolean {
    const thread = this.thread(threadId);
    return Boolean(thread && !thread.name?.trim());
  }

  private thread(threadId: string): Thread | undefined {
    return this.state.threadList.listedThreads.find((item) => item.id === threadId);
  }
}
