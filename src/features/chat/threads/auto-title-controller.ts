import type { AppServerClient } from "../../../app-server/connection/client";
import type { Thread } from "../../../domain/threads/model";
import type { ThreadConversationSummary } from "../../../domain/threads/transcript";
import type { CodexPanelSettings } from "../../../settings/model";
import { generateThreadTitleWithCodex } from "../../thread-title/generation";
import { threadTitleContextFromConversationSummary, type ThreadTitleContext } from "../../thread-title/model";
import type { ChatAction, ChatState, ChatStateStore } from "../state/reducer";
import { messageStreamDisplayItems } from "../state/message-stream";
import { threadTitleContextFromDisplayItems } from "./title-context";

export interface AutoTitleControllerHost {
  stateStore: ChatStateStore;
  vaultPath: string;
  settings: () => CodexPanelSettings;
  currentClient: () => AppServerClient | null;
  notifyThreadRenamed: (threadId: string, name: string) => void;
  generateThreadTitle?: (context: ThreadTitleContext) => Promise<string | null>;
}

export class AutoTitleController {
  private activeThreadHadTurns = false;
  private readonly attemptedThreadIds = new Set<string>();
  private readonly inFlightThreadIds = new Set<string>();

  constructor(private readonly host: AutoTitleControllerHost) {}

  private get state(): ChatState {
    return this.host.stateStore.getState();
  }

  private dispatch(action: ChatAction): void {
    this.host.stateStore.dispatch(action);
  }

  resetThreadTurnPresence(hadTurns: boolean): void {
    this.activeThreadHadTurns = hadTurns;
  }

  maybeAutoTitleThread(threadId: string, turnId: string, completedSummary: ThreadConversationSummary | null): void {
    const hadTurnsBeforeThisCompletion = this.activeThreadHadTurns;
    this.activeThreadHadTurns = true;

    if (hadTurnsBeforeThisCompletion || !completedSummary) return;
    if (this.threadHasTitle(threadId)) return;
    if (this.attemptedThreadIds.has(threadId) || this.inFlightThreadIds.has(threadId)) return;
    const context =
      threadTitleContextFromConversationSummary(completedSummary) ??
      threadTitleContextFromDisplayItems(turnId, messageStreamDisplayItems(this.state.messageStream));
    if (!context) return;

    this.attemptedThreadIds.add(threadId);
    this.inFlightThreadIds.add(threadId);
    void this.generateAndSetTitle(threadId, context);
  }

  private async generateAndSetTitle(threadId: string, context: ThreadTitleContext): Promise<void> {
    try {
      const title = await this.generateTitle(context);
      if (!title || !this.threadCanReceiveGeneratedTitle(threadId)) return;

      const client = this.host.currentClient();
      if (!client) return;
      await client.setThreadName(threadId, title);
      if (!this.threadCanReceiveGeneratedTitle(threadId)) return;
      this.dispatch({
        type: "thread-list/applied",
        threads: this.state.threadList.listedThreads.map((thread) => (thread.id === threadId ? { ...thread, name: title } : thread)),
      });
      this.host.notifyThreadRenamed(threadId, title);
    } catch {
      // Auto-title is best-effort metadata. Leave the thread preview untouched on failure.
    } finally {
      this.inFlightThreadIds.delete(threadId);
    }
  }

  private async generateTitle(context: ThreadTitleContext): Promise<string | null> {
    if (this.host.generateThreadTitle) return this.host.generateThreadTitle(context);
    const settings = this.host.settings();
    return generateThreadTitleWithCodex(settings.codexPath, this.host.vaultPath, context, {
      threadNamingModel: settings.threadNamingModel,
      threadNamingEffort: settings.threadNamingEffort,
    });
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
