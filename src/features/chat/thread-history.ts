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

type ThreadHistoryLoadLifecycleState = { kind: "idle" } | { kind: "loading"; threadId: string; mode: "latest" | "older" };
type ActiveThreadHistoryLoad = Extract<ThreadHistoryLoadLifecycleState, { kind: "loading" }>;

export class ThreadHistoryLoader {
  private lifecycle: ThreadHistoryLoadLifecycleState = { kind: "idle" };

  constructor(private readonly host: ThreadHistoryLoaderHost) {}

  private get state(): ChatState {
    return this.host.stateStore.getState();
  }

  private dispatch(action: ChatAction): void {
    this.host.stateStore.dispatch(action);
  }

  invalidate(): void {
    this.lifecycle = { kind: "idle" };
    this.dispatch({ type: "history/loading-set", loading: false });
  }

  async loadLatest(threadId = this.state.activeThreadId): Promise<void> {
    const client = this.host.currentClient();
    if (!client || !threadId) return;
    const load = this.startLoading(threadId, "latest");
    try {
      const response = await client.threadTurnsList(threadId, null, 20);
      if (this.isStale(load)) return;
      this.host.setThreadTurnPresence(response.data.length > 0);
      this.dispatch({ type: "display/items-replaced", items: displayItemsFromTurns(response.data), historyCursor: response.nextCursor });
      this.host.forceMessagesToBottom();
    } catch (error) {
      if (this.isStale(load)) return;
      this.host.addSystemMessage(error instanceof Error ? error.message : String(error));
    } finally {
      this.finishLoading(load);
    }
  }

  async loadOlder(): Promise<void> {
    const client = this.host.currentClient();
    const state = this.state;
    if (!client || !state.activeThreadId || !state.historyCursor || state.loadingHistory) return;
    const threadId = state.activeThreadId;
    const cursor = state.historyCursor;
    const load = this.startLoading(threadId, "older");
    try {
      const response = await client.threadTurnsList(threadId, cursor, 20);
      if (this.isStale(load)) return;
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
      if (this.isStale(load)) return;
      this.host.addSystemMessage(error instanceof Error ? error.message : String(error));
    } finally {
      this.finishLoading(load);
    }
  }

  private startLoading(threadId: string, mode: ActiveThreadHistoryLoad["mode"]): ActiveThreadHistoryLoad {
    const load: ActiveThreadHistoryLoad = { kind: "loading", threadId, mode };
    this.lifecycle = load;
    this.dispatch({ type: "history/loading-set", loading: true });
    this.host.render();
    return load;
  }

  private finishLoading(load: ActiveThreadHistoryLoad): void {
    if (this.isStale(load)) return;
    this.lifecycle = { kind: "idle" };
    this.dispatch({ type: "history/loading-set", loading: false });
    this.host.render();
  }

  private isStale(load: ActiveThreadHistoryLoad): boolean {
    return this.lifecycle !== load || this.state.activeThreadId !== load.threadId;
  }
}
