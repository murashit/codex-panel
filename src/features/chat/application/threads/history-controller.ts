import type { ChatAction, ChatState } from "../state/root-reducer";
import type { ChatStateStore } from "../state/store";
import { threadStreamItems } from "../state/thread-stream";
import type { ThreadHistoryPage, ThreadHistoryTransport } from "./thread-loading-transport";

export interface HistoryControllerHost {
  stateStore: ChatStateStore;
  historyTransport: ThreadHistoryTransport;
  addSystemMessage: (text: string) => void;
  showLatestPageAtBottom: () => void;
  setThreadTurnPresence: (hadTurns: boolean) => void;
}

type ThreadHistoryLoadLifecycleState = { kind: "idle" } | { kind: "loading"; threadId: string; mode: "latest" | "older" };
type ActiveThreadHistoryLoad = Extract<ThreadHistoryLoadLifecycleState, { kind: "loading" }>;
type ThreadHistoryLoadLifecycleEvent =
  | { type: "started"; load: ActiveThreadHistoryLoad }
  | { type: "finished"; load: ActiveThreadHistoryLoad }
  | { type: "invalidated" };

export class HistoryController {
  private lifecycle: ThreadHistoryLoadLifecycleState = { kind: "idle" };

  constructor(private readonly host: HistoryControllerHost) {}

  private get state(): ChatState {
    return this.host.stateStore.getState();
  }

  private dispatch(action: ChatAction): void {
    this.host.stateStore.dispatch(action);
  }

  invalidate(): void {
    this.lifecycle = transitionThreadHistoryLoadLifecycle(this.lifecycle, { type: "invalidated" });
    this.dispatch({ type: "thread-stream/history-loading-set", loading: false });
  }

  async loadLatest(threadId = this.state.activeThread.id): Promise<void> {
    if (!threadId) return;
    const load = this.startLoading(threadId, "latest");
    try {
      const response = await this.host.historyTransport.readHistoryPage(threadId, null, 20);
      if (!response) return;
      if (this.isStale(load)) return;
      this.applyLatestPage(threadId, response);
    } catch (error) {
      if (this.isStale(load)) return;
      this.host.addSystemMessage(error instanceof Error ? error.message : String(error));
    } finally {
      this.finishLoading(load);
    }
  }

  applyLatestPage(threadId: string, response: ThreadHistoryPage): boolean {
    if (this.state.activeThread.id !== threadId) return false;
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
    if (!state.activeThread.id || !state.threadStream.historyCursor || state.threadStream.loadingHistory) return;
    const threadId = state.activeThread.id;
    const cursor = state.threadStream.historyCursor;
    const load = this.startLoading(threadId, "older");
    try {
      const response = await this.host.historyTransport.readHistoryPage(threadId, cursor, 20);
      if (!response) return;
      if (this.isStale(load)) return;
      const current = this.state;
      const currentItems = threadStreamItems(current.threadStream);
      const olderItems = response.items;
      const existingIds = new Set(currentItems.map((item) => item.id));
      this.dispatch({
        type: "thread-stream/items-replaced",
        items: [...olderItems.filter((item) => !existingIds.has(item.id)), ...currentItems],
        historyCursor: response.nextCursor,
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
    this.lifecycle = transitionThreadHistoryLoadLifecycle(this.lifecycle, { type: "started", load });
    this.dispatch({ type: "thread-stream/history-loading-set", loading: true });
    return load;
  }

  private finishLoading(load: ActiveThreadHistoryLoad): void {
    if (this.isStale(load)) return;
    this.lifecycle = transitionThreadHistoryLoadLifecycle(this.lifecycle, { type: "finished", load });
    this.dispatch({ type: "thread-stream/history-loading-set", loading: false });
  }

  private isStale(load: ActiveThreadHistoryLoad): boolean {
    return this.lifecycle !== load || this.state.activeThread.id !== load.threadId;
  }
}

function transitionThreadHistoryLoadLifecycle(
  state: ThreadHistoryLoadLifecycleState,
  event: ThreadHistoryLoadLifecycleEvent,
): ThreadHistoryLoadLifecycleState {
  switch (event.type) {
    case "started":
      return event.load;
    case "finished":
      return state === event.load ? { kind: "idle" } : state;
    case "invalidated":
      return state.kind === "idle" ? state : { kind: "idle" };
  }
}
