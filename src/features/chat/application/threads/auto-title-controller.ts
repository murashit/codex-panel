import type { AppServerClient } from "../../../../app-server/connection/client";
import type { Thread } from "../../../../domain/threads/model";
import type { ThreadConversationSummary } from "../../../../domain/threads/transcript";
import type { CodexPanelSettings } from "../../../../settings/model";
import { renameThreadOnAppServer, threadRenameFromValue } from "../../../thread-operations/rename";
import { generateThreadTitleWithCodex } from "../../../thread-operations/title-generation";
import { threadTitleContextFromConversationSummary, type ThreadTitleContext } from "../../../thread-operations/title-model";
import type { ChatAction, ChatState } from "../state/root-reducer";
import type { ChatStateStore } from "../state/store";
import { messageStreamItems } from "../state/message-stream";
import { threadTitleContextFromMessageStreamItems } from "./title-context";

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

    if (hadTurnsBeforeThisCompletion) return;
    if (this.threadHasTitle(threadId)) return;
    if (this.attemptedThreadIds.has(threadId) || this.inFlightThreadIds.has(threadId)) return;
    const context = this.titleContextForCompletedTurn(turnId, completedSummary);
    if (!context) return;

    this.attemptedThreadIds.add(threadId);
    this.inFlightThreadIds.add(threadId);
    void this.generateAndSetTitle(threadId, context);
  }

  private titleContextForCompletedTurn(turnId: string, completedSummary: ThreadConversationSummary | null): ThreadTitleContext | null {
    const visibleContext = threadTitleContextFromMessageStreamItems(turnId, messageStreamItems(this.state.messageStream));
    if (visibleContext) return visibleContext;
    return completedSummary ? threadTitleContextFromConversationSummary(completedSummary) : null;
  }

  private async generateAndSetTitle(threadId: string, context: ThreadTitleContext): Promise<void> {
    try {
      const title = await this.generateTitle(context);
      if (!title || !this.threadCanReceiveGeneratedTitle(threadId)) return;
      const rename = threadRenameFromValue(title);
      if (!rename) return;

      const client = this.host.currentClient();
      if (!client) return;
      const result = await renameThreadOnAppServer(client, threadId, rename);
      if (!this.threadCanReceiveGeneratedTitle(threadId)) return;
      this.dispatch({
        type: "thread-list/applied",
        threads: this.state.threadList.listedThreads.map((thread) => (thread.id === threadId ? { ...thread, name: result.name } : thread)),
      });
      this.host.notifyThreadRenamed(threadId, result.name);
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
