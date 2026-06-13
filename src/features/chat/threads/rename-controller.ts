import type { AppServerClient } from "../../../app-server/connection/client";
import { readCompletedConversationSummariesPage } from "../../../app-server/services/threads";
import { getThreadTitle } from "../../../domain/threads/model";
import type { Thread } from "../../../domain/threads/model";
import type { CodexPanelSettings } from "../../../settings/model";
import { generateThreadTitleWithCodex } from "../../thread-title/generation";
import { findThreadTitleContext, THREAD_TITLE_CONTEXT_UNAVAILABLE_MESSAGE, type ThreadTitleContext } from "../../thread-title/model";
import {
  renameGenerationStillActive,
  type ChatAction,
  type ChatRenameGeneratingUiState,
  type ChatRenameUiState,
  type ChatState,
  type ChatStateStore,
} from "../state/reducer";
import { messageStreamDisplayItems } from "../state/message-stream";
import { renameConnectedThread } from "./rename-actions";
import { firstThreadTitleContextFromDisplayItems } from "./title-context";

export interface RenameEditState {
  draft: string;
  generating: boolean;
}

export interface RenameControllerHost {
  stateStore: ChatStateStore;
  vaultPath: string;
  settings: () => CodexPanelSettings;
  ensureConnected: () => Promise<void>;
  currentClient: () => AppServerClient | null;
  addSystemMessage: (text: string) => void;
  notifyThreadRenamed: (threadId: string, name: string) => void;
  generateThreadTitle?: (context: ThreadTitleContext) => Promise<string | null>;
}

export class RenameController {
  private nextRenameGenerationId = 1;

  constructor(private readonly host: RenameControllerHost) {}

  private get state(): ChatState {
    return this.host.stateStore.getState();
  }

  private get renameState(): ChatRenameUiState {
    return this.state.ui.rename;
  }

  private dispatch(action: ChatAction): void {
    this.host.stateStore.dispatch(action);
  }

  editState(threadId: string): RenameEditState | null {
    if (this.renameState.kind === "idle" || this.renameState.threadId !== threadId) return null;
    return {
      draft: this.renameState.draft,
      generating: this.renameState.kind === "generating",
    };
  }

  isEditing(): boolean {
    return this.renameState.kind !== "idle";
  }

  start(threadId: string): void {
    const thread = this.thread(threadId);
    if (!thread) return;
    this.dispatch({ type: "ui/rename-started", threadId, draft: getThreadTitle(thread) });
  }

  updateDraft(threadId: string, value: string): void {
    this.dispatch({ type: "ui/rename-draft-updated", threadId, draft: value });
  }

  cancel(threadId: string): void {
    this.dispatch({ type: "ui/rename-cancelled", threadId });
  }

  async save(threadId: string, value: string): Promise<void> {
    if (this.renameState.kind === "idle" || this.renameState.threadId !== threadId || this.renameState.kind === "generating") return;
    const editingState = this.renameState;
    const title = value.trim();
    if (!title) {
      this.cancel(threadId);
      return;
    }

    await this.host.ensureConnected();
    if (this.renameState !== editingState) return;
    const client = this.host.currentClient();
    if (!client) return;

    if (await renameConnectedThread(this.host, threadId, title)) {
      if (this.renameState === editingState) this.clear();
    }
  }

  async autoNameDraft(threadId: string): Promise<void> {
    if (this.renameState.kind !== "editing" || this.renameState.threadId !== threadId) return;

    const editingState = this.renameState;

    await this.host.ensureConnected();
    if (this.renameState !== editingState) return;

    this.dispatch({
      type: "ui/rename-generation-started",
      threadId,
      originalDraft: editingState.draft,
      generationId: this.nextRenameGenerationId,
    });
    const generatingState: ChatRenameUiState = this.host.stateStore.getState().ui.rename;
    if (generatingState.kind !== "generating") return;
    this.nextRenameGenerationId += 1;

    try {
      const context = await this.resolveNamingContext(threadId);
      if (!context) throw new Error(THREAD_TITLE_CONTEXT_UNAVAILABLE_MESSAGE);
      const title = await this.generateTitle(context);
      if (!title) throw new Error("Codex did not return a usable thread title.");
      this.dispatch({ type: "ui/rename-generation-succeeded", generatingState, draft: title });
    } catch (error) {
      if (renameGenerationStillActive(this.renameState, generatingState)) {
        this.host.addSystemMessage(error instanceof Error ? error.message : String(error));
      }
    } finally {
      this.finishAutoNameDraftGeneration(threadId, generatingState);
    }
  }

  private async resolveNamingContext(threadId: string): Promise<ThreadTitleContext | null> {
    const client = this.host.currentClient();
    if (!client) return null;
    const context = await findThreadTitleContext({
      threadId,
      readTurns: (id, cursor, limit, sortDirection) => readCompletedConversationSummariesPage(client, id, cursor, limit, sortDirection),
    });
    return (
      context ??
      (this.state.activeThread.id === threadId
        ? firstThreadTitleContextFromDisplayItems(messageStreamDisplayItems(this.state.messageStream))
        : null)
    );
  }

  private async generateTitle(context: ThreadTitleContext): Promise<string | null> {
    if (this.host.generateThreadTitle) return this.host.generateThreadTitle(context);
    const settings = this.host.settings();
    return generateThreadTitleWithCodex(settings.codexPath, this.host.vaultPath, context, {
      threadNamingModel: settings.threadNamingModel,
      threadNamingEffort: settings.threadNamingEffort,
    });
  }

  private clear(): void {
    this.dispatch({ type: "ui/rename-cleared" });
  }

  private finishAutoNameDraftGeneration(threadId: string, generatingState: ChatRenameGeneratingUiState): void {
    this.dispatch({ type: "ui/rename-generation-finished", threadId, generatingState });
  }

  private thread(threadId: string): Thread | undefined {
    return this.state.threadList.listedThreads.find((item) => item.id === threadId);
  }
}
