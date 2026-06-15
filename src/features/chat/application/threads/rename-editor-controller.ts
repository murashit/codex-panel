import { getThreadTitle } from "../../../../domain/threads/model";
import type { Thread } from "../../../../domain/threads/model";
import type { ThreadTitleContext } from "../../../../domain/threads/title-generation-model";
import type { ThreadOperations } from "../../../threads/thread-operations";
import type { ThreadTitleService } from "../../../threads/thread-title-service";
import {
  renameGenerationStillActive,
  type ChatAction,
  type ChatRenameGeneratingUiState,
  type ChatRenameUiState,
  type ChatState,
} from "../state/root-reducer";
import type { ChatStateStore } from "../state/store";
import { messageStreamItems } from "../state/message-stream";
import { firstThreadTitleContextFromMessageStreamItems } from "./title-context";

export interface RenameEditState {
  draft: string;
  generating: boolean;
}

export interface ThreadRenameEditorControllerHost {
  stateStore: ChatStateStore;
  ensureConnected: () => Promise<void>;
  addSystemMessage: (text: string) => void;
  operations: Pick<ThreadOperations, "renameThread">;
  titleService: Pick<ThreadTitleService, "generateTitle">;
}

export class ThreadRenameEditorController {
  private nextRenameGenerationId = 1;

  constructor(private readonly host: ThreadRenameEditorControllerHost) {}

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

    await this.host.ensureConnected();
    if (this.renameState !== editingState) return;

    const result = await this.host.operations.renameThread(threadId, value);
    if (!result) {
      if (this.renameState === editingState) this.cancel(threadId);
      return;
    }
    if (this.renameState === editingState) {
      this.clear();
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
      const title = await this.host.titleService.generateTitle(threadId);
      this.dispatch({ type: "ui/rename-generation-succeeded", generatingState, draft: title });
    } catch (error) {
      if (renameGenerationStillActive(this.renameState, generatingState)) {
        this.host.addSystemMessage(error instanceof Error ? error.message : String(error));
      }
    } finally {
      this.finishAutoNameDraftGeneration(threadId, generatingState);
    }
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

export function activeThreadRenameTitleContext(state: ChatState, threadId: string): ThreadTitleContext | null {
  return state.activeThread.id === threadId ? firstThreadTitleContextFromMessageStreamItems(messageStreamItems(state.messageStream)) : null;
}
