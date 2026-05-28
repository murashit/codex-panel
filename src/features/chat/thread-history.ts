import type { AppServerClient } from "../../app-server/client";
import { displayItemsFromTurns } from "./display/thread-items";
import type { ChatAction, ChatState, ChatStateStore } from "./chat-state";

export interface ThreadHistoryLoaderHost {
  stateStore: ChatStateStore;
  currentClient: () => AppServerClient | null;
  render: () => void;
  addSystemMessage: (text: string) => void;
  forceMessagesToBottom: () => void;
  keepCurrentScrollPosition: () => void;
  setThreadTurnPresence: (hadTurns: boolean) => void;
}

export class ThreadHistoryLoader {
  private generation = 0;

  constructor(private readonly host: ThreadHistoryLoaderHost) {}

  private get state(): ChatState {
    return this.host.stateStore.getState();
  }

  private dispatch(action: ChatAction): void {
    this.host.stateStore.dispatch(action);
  }

  invalidate(): void {
    this.generation += 1;
    this.dispatch({ type: "history/loading-set", loading: false });
  }

  async loadLatest(threadId = this.state.activeThreadId): Promise<void> {
    const client = this.host.currentClient();
    if (!client || !threadId) return;
    const generation = ++this.generation;
    this.dispatch({ type: "history/loading-set", loading: true });
    this.host.render();
    try {
      const response = await client.threadTurnsList(threadId, null, 20);
      if (this.isStale(generation, threadId)) return;
      this.host.setThreadTurnPresence(response.data.length > 0);
      this.dispatch({ type: "display/items-replaced", items: displayItemsFromTurns(response.data), historyCursor: response.nextCursor });
      this.host.forceMessagesToBottom();
    } catch (error) {
      if (this.isStale(generation, threadId)) return;
      this.host.addSystemMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (!this.isStale(generation, threadId)) {
        this.dispatch({ type: "history/loading-set", loading: false });
        this.host.render();
      }
    }
  }

  async loadOlder(): Promise<void> {
    const client = this.host.currentClient();
    const state = this.state;
    if (!client || !state.activeThreadId || !state.historyCursor || state.loadingHistory) return;
    const threadId = state.activeThreadId;
    const cursor = state.historyCursor;
    const generation = ++this.generation;
    this.dispatch({ type: "history/loading-set", loading: true });
    this.host.render();
    try {
      const response = await client.threadTurnsList(threadId, cursor, 20);
      if (this.isStale(generation, threadId)) return;
      const current = this.state;
      const olderItems = displayItemsFromTurns(response.data);
      const existingIds = new Set(current.displayItems.map((item) => item.id));
      this.host.keepCurrentScrollPosition();
      this.dispatch({
        type: "display/items-replaced",
        items: [...olderItems.filter((item) => !existingIds.has(item.id)), ...current.displayItems],
        historyCursor: response.nextCursor,
        messagesPinnedToBottom: false,
      });
    } catch (error) {
      if (this.isStale(generation, threadId)) return;
      this.host.addSystemMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (!this.isStale(generation, threadId)) {
        this.dispatch({ type: "history/loading-set", loading: false });
        this.host.render();
      }
    }
  }

  private isStale(generation: number, threadId: string): boolean {
    return generation !== this.generation || this.state.activeThreadId !== threadId;
  }
}
