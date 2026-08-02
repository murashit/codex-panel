import type { ThreadStreamItem } from "../../domain/thread-stream/items";
import { chatThreadStreamViewState } from "../state/active-turn";
import { activeThreadId, type ChatAction, type ChatState } from "../state/root-reducer";
import type { ChatStateStore } from "../state/store";
import { threadStreamItems } from "../state/thread-stream";

export interface ThreadHistoryPage {
  items: ThreadStreamItem[];
  nextCursor: string | null;
  hadTurns: boolean;
}

export interface ThreadHistorySource {
  readHistoryPage(threadId: string, cursor: string | null, limit: number): Promise<ThreadHistoryPage | null>;
}

export interface HistoryControllerHost {
  stateStore: ChatStateStore;
  source: ThreadHistorySource;
  addSystemMessage: (text: string) => void;
  showLatestPageAtBottom: () => void;
  setThreadTurnPresence: (hadTurns: boolean) => void;
}

interface ActiveThreadHistoryLoad {
  readonly threadId: string;
}

export class HistoryController {
  private activeLoad: ActiveThreadHistoryLoad | null = null;

  constructor(private readonly host: HistoryControllerHost) {}

  private get state(): ChatState {
    return this.host.stateStore.getState();
  }

  private dispatch(action: ChatAction): void {
    this.host.stateStore.dispatch(action);
  }

  invalidate(): void {
    this.activeLoad = null;
    this.dispatch({ type: "thread-stream/history-loading-set", loading: false });
  }

  async loadLatest(threadId = activeThreadId(this.state)): Promise<void> {
    if (!threadId) return;
    const load = this.startLoading(threadId);
    try {
      const response = await this.host.source.readHistoryPage(threadId, null, 20);
      if (!response) return;
      if (!this.isCurrent(load)) return;
      this.applyLatestPage(threadId, response);
    } catch (error) {
      if (!this.isCurrent(load)) return;
      this.host.addSystemMessage(error instanceof Error ? error.message : String(error));
    } finally {
      this.finishLoading(load);
    }
  }

  applyLatestPage(threadId: string, response: ThreadHistoryPage): boolean {
    if (activeThreadId(this.state) !== threadId) return false;
    this.host.setThreadTurnPresence(response.hadTurns);
    this.host.showLatestPageAtBottom();
    this.dispatch({
      type: "thread-stream/items-replaced",
      items: response.items,
      historyCursor: response.nextCursor,
    });
    return true;
  }

  async loadOlder(): Promise<void> {
    const state = this.state;
    const threadId = activeThreadId(state);
    if (!threadId || !state.threadStream.historyCursor || state.threadStream.loadingHistory) return;
    const cursor = state.threadStream.historyCursor;
    const load = this.startLoading(threadId);
    try {
      const response = await this.host.source.readHistoryPage(threadId, cursor, 20);
      if (!response) return;
      if (!this.isCurrent(load)) return;
      const current = this.state;
      const currentItems = threadStreamItems(chatThreadStreamViewState(current.threadStream, current.activeTurn));
      const olderItems = response.items;
      const existingIds = new Set(currentItems.map((item) => item.id));
      this.dispatch({
        type: "thread-stream/items-replaced",
        items: [...olderItems.filter((item) => !existingIds.has(item.id)), ...currentItems],
        historyCursor: response.nextCursor,
      });
    } catch (error) {
      if (!this.isCurrent(load)) return;
      this.host.addSystemMessage(error instanceof Error ? error.message : String(error));
    } finally {
      this.finishLoading(load);
    }
  }

  private startLoading(threadId: string): ActiveThreadHistoryLoad {
    const load = { threadId };
    this.activeLoad = load;
    this.dispatch({ type: "thread-stream/history-loading-set", loading: true });
    return load;
  }

  private finishLoading(load: ActiveThreadHistoryLoad): void {
    if (!this.isCurrent(load)) return;
    this.activeLoad = null;
    this.dispatch({ type: "thread-stream/history-loading-set", loading: false });
  }

  private isCurrent(load: ActiveThreadHistoryLoad): boolean {
    return this.activeLoad === load && activeThreadId(this.state) === load.threadId;
  }
}
