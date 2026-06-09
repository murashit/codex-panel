import type { AppServerClient } from "../../../app-server/client";
import { getThreadTitle } from "../../../domain/threads/model";
import {
  findThreadNamingContext,
  namingContextFromConversationSummary,
  THREAD_NAMING_CONTEXT_UNAVAILABLE_MESSAGE,
  type ThreadNamingContext,
} from "../../../domain/threads/naming";
import type { Thread } from "../../../domain/threads/model";
import type { Turn } from "../../../generated/app-server/v2/Turn";
import type { CodexPanelSettings } from "../../../settings/model";
import type { ChatAction, ChatState, ChatStateStore } from "../chat-state";
import { generateThreadTitleWithCodex } from "../../../app-server/thread-title-generation";
import { completedConversationSummaryFromAppServerTurn } from "../../../app-server/turn-model";
import { firstNamingContextFromDisplayItems, namingContextFromDisplayItems } from "./thread-naming";

export interface ThreadRenameEditState {
  draft: string;
  generating: boolean;
}

type RenameLifecycleState =
  | { kind: "idle" }
  | { kind: "editing"; threadId: string; draft: string }
  | { kind: "generating"; threadId: string; draft: string; originalDraft: string };
type RenameGeneratingState = Extract<RenameLifecycleState, { kind: "generating" }>;
type RenameLifecycleEvent =
  | { type: "started"; threadId: string; draft: string }
  | { type: "draft-updated"; threadId: string; draft: string }
  | { type: "cancelled"; threadId: string }
  | { type: "generation-started"; threadId: string; originalDraft: string }
  | { type: "generation-succeeded"; generatingState: RenameGeneratingState; draft: string }
  | { type: "generation-finished"; threadId: string; generatingState: RenameGeneratingState }
  | { type: "cleared" };

export interface ThreadRenameControllerHost {
  stateStore: ChatStateStore;
  vaultPath: string;
  settings: () => CodexPanelSettings;
  ensureConnected: () => Promise<void>;
  currentClient: () => AppServerClient | null;
  refreshThreads: () => Promise<void>;
  render: () => void;
  addSystemMessage: (text: string) => void;
  notifyThreadRenamed: (threadId: string, name: string) => void;
  generateThreadTitle?: (context: ThreadNamingContext) => Promise<string | null>;
}

export class ThreadRenameController {
  private activeThreadHadTurns = false;
  private readonly autoNameAttemptedThreadIds = new Set<string>();
  private readonly autoNameInFlightThreadIds = new Set<string>();
  private renameState: RenameLifecycleState = { kind: "idle" };

  constructor(private readonly host: ThreadRenameControllerHost) {}

  private get state(): ChatState {
    return this.host.stateStore.getState();
  }

  private dispatch(action: ChatAction): void {
    this.host.stateStore.dispatch(action);
  }

  resetThreadTurnPresence(hadTurns: boolean): void {
    this.activeThreadHadTurns = hadTurns;
  }

  editState(threadId: string): ThreadRenameEditState | null {
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
    this.renameState = transitionRenameLifecycle(this.renameState, { type: "started", threadId, draft: getThreadTitle(thread) });
    this.host.render();
  }

  updateDraft(threadId: string, value: string): void {
    const next = transitionRenameLifecycle(this.renameState, { type: "draft-updated", threadId, draft: value });
    if (next === this.renameState) return;
    this.renameState = next;
    this.host.render();
  }

  cancel(threadId: string): void {
    const next = transitionRenameLifecycle(this.renameState, { type: "cancelled", threadId });
    if (next === this.renameState) return;
    this.renameState = next;
    this.host.render();
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

    try {
      await client.setThreadName(threadId, title);
      this.dispatch({
        type: "thread-list/applied",
        threads: this.state.threadList.listedThreads.map((thread) => (thread.id === threadId ? { ...thread, name: title } : thread)),
      });
      this.clear();
      this.host.notifyThreadRenamed(threadId, title);
    } catch (error) {
      this.host.addSystemMessage(error instanceof Error ? error.message : String(error));
    } finally {
      this.host.render();
    }
  }

  async rename(threadId: string, value: string): Promise<void> {
    const title = value.trim();
    if (!title) return;

    await this.host.ensureConnected();
    const client = this.host.currentClient();
    if (!client) return;

    try {
      await client.setThreadName(threadId, title);
      this.dispatch({
        type: "thread-list/applied",
        threads: this.state.threadList.listedThreads.map((thread) => (thread.id === threadId ? { ...thread, name: title } : thread)),
      });
      this.host.notifyThreadRenamed(threadId, title);
    } catch (error) {
      this.host.addSystemMessage(error instanceof Error ? error.message : String(error));
    } finally {
      this.host.render();
    }
  }

  async autoNameDraft(threadId: string): Promise<void> {
    if (this.renameState.kind !== "editing" || this.renameState.threadId !== threadId) return;

    const editingState = this.renameState;

    await this.host.ensureConnected();
    if (this.renameState !== editingState) return;

    const generatingState = transitionRenameLifecycle(this.renameState, {
      type: "generation-started",
      threadId,
      originalDraft: editingState.draft,
    });
    if (generatingState.kind !== "generating") return;
    this.renameState = generatingState;
    this.host.render();

    try {
      const context = await this.resolveNamingContext(threadId);
      if (!context) throw new Error(THREAD_NAMING_CONTEXT_UNAVAILABLE_MESSAGE);
      const title = await this.generateTitle(context);
      if (!title) throw new Error("Codex did not return a usable thread title.");
      this.renameState = transitionRenameLifecycle(this.renameState, {
        type: "generation-succeeded",
        generatingState,
        draft: title,
      });
    } catch (error) {
      if (this.renameState === generatingState) {
        this.host.addSystemMessage(error instanceof Error ? error.message : String(error));
      }
    } finally {
      this.finishAutoNameDraftGeneration(threadId, generatingState);
    }
  }

  maybeAutoNameThread(threadId: string, turn: Turn): void {
    const hadTurnsBeforeThisCompletion = this.activeThreadHadTurns;
    this.activeThreadHadTurns = true;

    if (hadTurnsBeforeThisCompletion || turn.status !== "completed") return;
    if (this.threadHasName(threadId)) return;
    if (this.autoNameAttemptedThreadIds.has(threadId) || this.autoNameInFlightThreadIds.has(threadId)) return;
    const summary = completedConversationSummaryFromAppServerTurn(turn);
    const context =
      (summary ? namingContextFromConversationSummary(summary) : null) ??
      namingContextFromDisplayItems(turn.id, this.state.transcript.displayItems);
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
      this.dispatch({
        type: "thread-list/applied",
        threads: this.state.threadList.listedThreads.map((thread) => (thread.id === threadId ? { ...thread, name: title } : thread)),
      });
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
      readTurns: async (id, cursor, limit, sortDirection) => {
        const response = await client.threadTurnsList(id, cursor, limit, sortDirection);
        return {
          data: response.data.flatMap((turn) => {
            const summary = completedConversationSummaryFromAppServerTurn(turn);
            return summary ? [summary] : [];
          }),
          nextCursor: response.nextCursor,
        };
      },
    });
    return (
      context ?? (this.state.activeThread.id === threadId ? firstNamingContextFromDisplayItems(this.state.transcript.displayItems) : null)
    );
  }

  private async generateTitle(context: ThreadNamingContext): Promise<string | null> {
    if (this.host.generateThreadTitle) return this.host.generateThreadTitle(context);
    const settings = this.host.settings();
    return generateThreadTitleWithCodex(settings.codexPath, this.host.vaultPath, context, {
      threadNamingModel: settings.threadNamingModel,
      threadNamingEffort: settings.threadNamingEffort,
    });
  }

  private clear(): void {
    this.renameState = transitionRenameLifecycle(this.renameState, { type: "cleared" });
  }

  private finishAutoNameDraftGeneration(threadId: string, generatingState: RenameGeneratingState): void {
    const next = transitionRenameLifecycle(this.renameState, { type: "generation-finished", threadId, generatingState });
    if (next === this.renameState) return;
    this.renameState = next;
    this.host.render();
  }

  private threadHasName(threadId: string): boolean {
    return Boolean(this.thread(threadId)?.name?.trim());
  }

  private thread(threadId: string): Thread | undefined {
    return this.state.threadList.listedThreads.find((item) => item.id === threadId);
  }
}

function transitionRenameLifecycle(state: RenameLifecycleState, event: RenameLifecycleEvent): RenameLifecycleState {
  switch (event.type) {
    case "started":
      return { kind: "editing", threadId: event.threadId, draft: event.draft };
    case "draft-updated":
      if (state.kind === "idle" || state.threadId !== event.threadId) return state;
      return { ...state, draft: event.draft };
    case "cancelled":
      if (state.kind === "idle" || state.threadId !== event.threadId) return state;
      return { kind: "idle" };
    case "generation-started":
      if (state.kind !== "editing" || state.threadId !== event.threadId) return state;
      return {
        kind: "generating",
        threadId: event.threadId,
        draft: state.draft,
        originalDraft: event.originalDraft,
      };
    case "generation-succeeded":
      if (state !== event.generatingState || state.draft !== event.generatingState.originalDraft) return state;
      return { ...state, draft: event.draft };
    case "generation-finished":
      if (state === event.generatingState) return { kind: "editing", threadId: event.threadId, draft: event.generatingState.draft };
      if (state.kind !== "generating" || state.threadId !== event.threadId) return state;
      return { kind: "editing", threadId: event.threadId, draft: state.draft };
    case "cleared":
      return state.kind === "idle" ? state : { kind: "idle" };
  }
}
