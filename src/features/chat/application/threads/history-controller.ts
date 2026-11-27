import { errorMessage } from "../../../../domain/text/error-message";
import type { ThreadHistoryPage } from "../../domain/thread-stream/history";
import type { ThreadStreamItem } from "../../domain/thread-stream/items";
import { activeThreadId, type ChatState, capturePanelTargetLease, type PanelTargetLease, panelTargetLeaseIsCurrent } from "../state/model";
import type { ChatAction } from "../state/reducer";
import type { ChatStateStore } from "../state/store";

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
  readonly panelTarget: PanelTargetLease;
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

  loadLatest(threadId = activeThreadId(this.state), displayItems: readonly ThreadStreamItem[] = []): Promise<void> {
    if (!threadId || threadId !== activeThreadId(this.state)) return Promise.resolve();
    return this.loadPage(threadId, null, displayItems);
  }

  showLatestPageAtBottom(): void {
    this.host.showLatestPageAtBottom();
  }

  loadOlder(): Promise<void> {
    const state = this.state;
    const threadId = historySourceThreadId(state);
    if (!threadId || !state.threadStream.historyCursor || state.threadStream.loadingHistory) return Promise.resolve();
    return this.loadPage(threadId, state.threadStream.historyCursor, state.threadStream.stableItems);
  }

  private async loadPage(threadId: string, cursor: string | null, displayItems: readonly ThreadStreamItem[]): Promise<void> {
    const state = this.state;
    const stableItemsAtStart = state.threadStream.stableItems;
    const load = { threadId, panelTarget: capturePanelTargetLease(state) };
    this.activeLoad = load;
    this.dispatch({ type: "thread-stream/history-loading-set", loading: true });
    try {
      const page = await this.host.source.readHistoryPage(threadId, cursor, 20);
      if (!page || !this.isCurrent(load)) return;
      if (cursor === null) {
        if (page.turns.length > 0) this.host.setThreadTurnPresence(true);
        this.showLatestPageAtBottom();
      }
      this.dispatch({ type: "thread-stream/history-loaded", page, stableItemsAtStart, displayItems, older: cursor !== null });
    } catch (error) {
      if (this.isCurrent(load)) this.host.addSystemMessage(errorMessage(error));
    } finally {
      if (this.isCurrent(load)) this.invalidate();
    }
  }

  private isCurrent(load: ActiveThreadHistoryLoad): boolean {
    return (
      this.activeLoad === load &&
      panelTargetLeaseIsCurrent(this.state, load.panelTarget) &&
      historySourceThreadId(this.state) === load.threadId
    );
  }
}

function historySourceThreadId(state: ChatState): string | null {
  return state.panelThread.kind === "fork-draft"
    ? state.panelThread.draft.kind === "persistent"
      ? state.panelThread.draft.sourceThreadId
      : null
    : activeThreadId(state);
}
