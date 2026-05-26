import type { AppServerClient } from "../../app-server/client";
import type { Thread } from "../../generated/app-server/v2/Thread";
import type { Turn } from "../../generated/app-server/v2/Turn";
import type { CodexPanelSettings } from "../../settings/model";
import type { ChatState } from "./chat-state";
import { getThreadTitle } from "../../domain/threads/model";
import {
  findThreadNamingContext,
  generateThreadTitleWithCodex,
  namingContextFromTurn,
  THREAD_NAMING_CONTEXT_UNAVAILABLE_MESSAGE,
  type ThreadNamingContext,
} from "../../domain/threads/naming";
import { firstNamingContextFromDisplayItems, namingContextFromDisplayItems } from "./thread-naming";

export interface ThreadRenameEditState {
  draft: string;
  generating: boolean;
}

export interface ThreadRenameControllerHost {
  state: ChatState;
  vaultPath: string;
  settings: () => CodexPanelSettings;
  ensureConnected: () => Promise<void>;
  currentClient: () => AppServerClient | null;
  refreshThreads: () => Promise<void>;
  render: () => void;
  addSystemMessage: (text: string) => void;
  notifyThreadRenamed: (threadId: string, name: string) => void;
}

export class ThreadRenameController {
  private activeThreadHadTurns = false;
  private readonly autoNameAttemptedThreadIds = new Set<string>();
  private readonly autoNameInFlightThreadIds = new Set<string>();
  private renameThreadId: string | null = null;
  private renameDraft = "";
  private renameAutoNameThreadId: string | null = null;
  private renameAutoNameGeneration = 0;

  constructor(private readonly host: ThreadRenameControllerHost) {}

  resetThreadTurnPresence(hadTurns: boolean): void {
    this.activeThreadHadTurns = hadTurns;
  }

  editState(threadId: string): ThreadRenameEditState | null {
    if (this.renameThreadId !== threadId) return null;
    return {
      draft: this.renameDraft,
      generating: this.renameAutoNameThreadId === threadId,
    };
  }

  start(threadId: string): void {
    const thread = this.thread(threadId);
    if (!thread) return;
    this.renameAutoNameGeneration += 1;
    this.renameAutoNameThreadId = null;
    this.renameThreadId = threadId;
    this.renameDraft = getThreadTitle(thread);
    this.host.render();
  }

  updateDraft(threadId: string, value: string): void {
    if (this.renameThreadId !== threadId) return;
    this.renameDraft = value;
  }

  cancel(threadId: string): void {
    if (this.renameThreadId !== threadId) return;
    this.clear();
    this.host.render();
  }

  async save(threadId: string, value: string): Promise<void> {
    if (this.renameThreadId !== threadId || this.renameAutoNameThreadId === threadId) return;
    const title = value.trim();
    if (!title) {
      this.cancel(threadId);
      return;
    }

    await this.host.ensureConnected();
    const client = this.host.currentClient();
    if (!client) return;

    try {
      await client.setThreadName(threadId, title);
      this.host.state.listedThreads = this.host.state.listedThreads.map((thread) =>
        thread.id === threadId ? { ...thread, name: title } : thread,
      );
      this.clear();
      this.host.notifyThreadRenamed(threadId, title);
    } catch (error) {
      this.host.addSystemMessage(error instanceof Error ? error.message : String(error));
    } finally {
      this.host.render();
    }
  }

  async autoNameDraft(threadId: string): Promise<void> {
    if (this.renameThreadId !== threadId || this.renameAutoNameThreadId === threadId) return;

    await this.host.ensureConnected();
    const generation = this.renameAutoNameGeneration + 1;
    const draftBeforeGeneration = this.renameDraft;
    this.renameAutoNameGeneration = generation;
    this.renameAutoNameThreadId = threadId;
    this.host.render();

    try {
      const context = await this.resolveNamingContext(threadId);
      if (!context) throw new Error(THREAD_NAMING_CONTEXT_UNAVAILABLE_MESSAGE);
      const title = await this.generateTitle(context);
      if (!title) throw new Error("Codex did not return a usable thread title.");
      if (this.renameThreadId !== threadId || this.renameAutoNameGeneration !== generation) return;
      if (this.renameDraft !== draftBeforeGeneration) return;
      this.renameDraft = title;
    } catch (error) {
      if (this.renameThreadId === threadId && this.renameAutoNameGeneration === generation) {
        this.host.addSystemMessage(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (this.renameThreadId === threadId && this.renameAutoNameGeneration === generation) {
        this.renameAutoNameThreadId = null;
        this.host.render();
      }
    }
  }

  maybeAutoNameThread(threadId: string, turn: Turn): void {
    const hadTurnsBeforeThisCompletion = this.activeThreadHadTurns;
    this.activeThreadHadTurns = true;

    if (hadTurnsBeforeThisCompletion || turn.status !== "completed") return;
    if (this.threadHasName(threadId)) return;
    if (this.autoNameAttemptedThreadIds.has(threadId) || this.autoNameInFlightThreadIds.has(threadId)) return;
    const context = namingContextFromTurn(turn) ?? namingContextFromDisplayItems(turn.id, this.host.state.displayItems);
    if (!context) return;

    this.autoNameAttemptedThreadIds.add(threadId);
    this.autoNameInFlightThreadIds.add(threadId);
    void this.generateAndSetName(threadId, context);
  }

  private async generateAndSetName(threadId: string, context: ThreadNamingContext): Promise<void> {
    try {
      const title = await this.generateTitle(context);
      if (!title || this.threadHasName(threadId)) return;

      const client = this.host.currentClient();
      if (!client) return;
      await client.setThreadName(threadId, title);
      this.host.state.listedThreads = this.host.state.listedThreads.map((thread) =>
        thread.id === threadId ? { ...thread, name: title } : thread,
      );
      this.host.notifyThreadRenamed(threadId, title);
    } catch {
      // Auto-naming is best-effort metadata. Leave the thread preview untouched on failure.
    } finally {
      this.autoNameInFlightThreadIds.delete(threadId);
      this.host.render();
    }
  }

  private async resolveNamingContext(threadId: string): Promise<ThreadNamingContext | null> {
    const client = this.host.currentClient();
    if (!client) return null;
    const context = await findThreadNamingContext({
      threadId,
      readTurns: (id, cursor, limit, sortDirection) => client.threadTurnsList(id, cursor, limit, sortDirection),
    });
    return (
      context ?? (this.host.state.activeThreadId === threadId ? firstNamingContextFromDisplayItems(this.host.state.displayItems) : null)
    );
  }

  private async generateTitle(context: ThreadNamingContext): Promise<string | null> {
    const settings = this.host.settings();
    return generateThreadTitleWithCodex(settings.codexPath, this.host.vaultPath, context, {
      threadNamingModel: settings.threadNamingModel,
      threadNamingEffort: settings.threadNamingEffort,
    });
  }

  private clear(): void {
    this.renameAutoNameGeneration += 1;
    this.renameThreadId = null;
    this.renameDraft = "";
    this.renameAutoNameThreadId = null;
  }

  private threadHasName(threadId: string): boolean {
    return Boolean(this.thread(threadId)?.name?.trim());
  }

  private thread(threadId: string): Thread | undefined {
    return this.host.state.listedThreads.find((item) => item.id === threadId);
  }
}
