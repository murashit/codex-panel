import type { ThreadStreamItem } from "../../domain/thread-stream/items";
import { activeThreadId, type ChatState } from "../state/model";
import { capturePanelTargetLease, type PanelTargetLease, panelTargetLeaseIsCurrent } from "../state/panel-target";
import type { ChatAction } from "../state/reducer";
import type { ChatStateStore } from "../state/store";
import { threadStreamItems } from "../state/thread-stream";
import { chatThreadStreamViewState } from "../state/turn-scope";
import { reconcileForkDisplayItems } from "./fork-display-snapshot";

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

interface LatestHistoryDisplayOptions {
  readonly displayItems?: readonly ThreadStreamItem[];
}

interface ActiveThreadHistoryLoad {
  readonly threadId: string;
  readonly panelTarget: PanelTargetLease;
  readonly stableItems: readonly ThreadStreamItem[];
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

  async loadLatest(threadId = activeThreadId(this.state), options: LatestHistoryDisplayOptions = {}): Promise<void> {
    if (!threadId || this.state.panelThread.kind === "fork-draft") return;
    const load = this.startLoading(threadId);
    try {
      const response = await this.host.source.readHistoryPage(threadId, null, 20);
      if (!response) return;
      if (!this.isCurrent(load)) return;
      this.applyLatestPage(threadId, response, options, load.stableItems);
    } catch (error) {
      if (!this.isCurrent(load)) return;
      this.host.addSystemMessage(error instanceof Error ? error.message : String(error));
    } finally {
      this.finishLoading(load);
    }
  }

  applyInitialPage(threadId: string, response: ThreadHistoryPage, options: LatestHistoryDisplayOptions = {}): boolean {
    return this.applyLatestPage(threadId, response, options, options.displayItems ?? []);
  }

  private applyLatestPage(
    threadId: string,
    response: ThreadHistoryPage,
    options: LatestHistoryDisplayOptions,
    stableItems: readonly ThreadStreamItem[],
  ): boolean {
    if (activeThreadId(this.state) !== threadId) return false;
    if (response.hadTurns) this.host.setThreadTurnPresence(true);
    this.host.showLatestPageAtBottom();
    this.publishHistoryItems(
      options.displayItems ? reconcileForkDisplayItems(options.displayItems, response.items) : response.items,
      response.nextCursor,
      stableItems,
    );
    return true;
  }

  async loadOlder(): Promise<void> {
    const state = this.state;
    const threadId = historySourceThreadId(state);
    if (!threadId || !state.threadStream.historyCursor || state.threadStream.loadingHistory) return;
    const cursor = state.threadStream.historyCursor;
    const load = this.startLoading(threadId);
    try {
      const response = await this.host.source.readHistoryPage(threadId, cursor, 20);
      if (!response) return;
      if (!this.isCurrent(load)) return;
      this.publishHistoryItems(
        reconcileForkDisplayItems(load.stableItems, response.items, { missingTurns: "prepend" }),
        response.nextCursor,
        load.stableItems,
      );
    } catch (error) {
      if (!this.isCurrent(load)) return;
      this.host.addSystemMessage(error instanceof Error ? error.message : String(error));
    } finally {
      this.finishLoading(load);
    }
  }

  private publishHistoryItems(
    items: readonly ThreadStreamItem[],
    historyCursor: string | null,
    stableItems: readonly ThreadStreamItem[],
  ): void {
    const state = this.state;
    const baselineById = new Map(stableItems.map((item) => [item.id, item]));
    const liveItems = threadStreamItems(chatThreadStreamViewState(state.threadStream, state.activeTurn)).filter(
      (item) => baselineById.get(item.id) !== item,
    );
    const liveById = new Map(liveItems.map((item) => [item.id, item]));
    // Hydration may settle after live notifications. Keep that content while admitting history-only items.
    const reconciled = reconcileForkDisplayItems(liveItems, items, { missingTurns: "prepend" });
    const orderedItems = new Map(items.map((item) => [item.id, item]));
    for (const item of reconciled) orderedItems.set(item.id, liveById.get(item.id) ?? item);
    this.dispatch({
      type: "thread-stream/content-replaced",
      items: [...orderedItems.values()],
      historyCursor,
    });
  }

  private startLoading(threadId: string): ActiveThreadHistoryLoad {
    const load = { threadId, panelTarget: capturePanelTargetLease(this.state), stableItems: this.state.threadStream.stableItems };
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
    return (
      this.activeLoad === load &&
      panelTargetLeaseIsCurrent(this.state, load.panelTarget) &&
      historySourceThreadId(this.state) === load.threadId
    );
  }
}

function historySourceThreadId(state: ChatState): string | null {
  return state.panelThread.kind === "fork-draft" ? state.panelThread.draft.sourceThreadId : activeThreadId(state);
}
