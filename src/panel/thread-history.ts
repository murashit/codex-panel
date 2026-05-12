import type { AppServerClient } from "../app-server/client";
import { displayItemsFromTurns } from "../display/model";
import type { PanelState } from "../state/panel-state";

export interface ThreadHistoryLoaderHost {
  state: PanelState;
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

  async loadLatest(threadId = this.host.state.activeThreadId): Promise<void> {
    const client = this.host.currentClient();
    if (!client || !threadId) return;
    const generation = ++this.generation;
    this.host.state.loadingHistory = true;
    this.host.render();
    try {
      const response = await client.threadTurnsList(threadId, null, 20);
      if (this.isStale(generation, threadId)) return;
      this.host.setThreadTurnPresence(response.data.length > 0);
      this.host.state.historyCursor = response.nextCursor;
      this.host.state.displayItems = displayItemsFromTurns(response.data);
      this.host.forceMessagesToBottom();
    } catch (error) {
      if (this.isStale(generation, threadId)) return;
      this.host.addSystemMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (!this.isStale(generation, threadId)) {
        this.host.state.loadingHistory = false;
        this.host.render();
      }
    }
  }

  async loadOlder(): Promise<void> {
    const client = this.host.currentClient();
    const state = this.host.state;
    if (!client || !state.activeThreadId || !state.historyCursor || state.loadingHistory) return;
    const threadId = state.activeThreadId;
    const cursor = state.historyCursor;
    const generation = ++this.generation;
    state.loadingHistory = true;
    this.host.render();
    try {
      const response = await client.threadTurnsList(threadId, cursor, 20);
      if (this.isStale(generation, threadId)) return;
      state.historyCursor = response.nextCursor;
      const olderItems = displayItemsFromTurns(response.data);
      const existingIds = new Set(state.displayItems.map((item) => item.id));
      state.messagesPinnedToBottom = false;
      this.host.keepCurrentScrollPosition();
      state.displayItems = [...olderItems.filter((item) => !existingIds.has(item.id)), ...state.displayItems];
    } catch (error) {
      if (this.isStale(generation, threadId)) return;
      this.host.addSystemMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (!this.isStale(generation, threadId)) {
        state.loadingHistory = false;
        this.host.render();
      }
    }
  }

  private isStale(generation: number, threadId: string): boolean {
    return generation !== this.generation || this.host.state.activeThreadId !== threadId;
  }
}
