import { type App, Notice, Platform, SuggestModal } from "obsidian";
import type { Thread } from "../../domain/threads/model";
import { compareThreadSearchMatches, threadSearchMatches } from "../../domain/threads/search";
import type { ThreadCatalogPaginatedActiveReader, ThreadCatalogSearchReader } from "../threads/catalog/thread-catalog";

export interface ThreadPickerHost {
  readonly app: App;
  readonly threadCatalog: ThreadCatalogPaginatedActiveReader & ThreadCatalogSearchReader;
  openThreadInCurrentView(threadId: string): Promise<void>;
  openThreadInAvailableView(threadId: string): Promise<void>;
}

export interface ThreadPickerController {
  close(): void;
}

interface ThreadSuggestion {
  thread: Thread;
  title: string;
}

type ThreadOpenMode = "current" | "available";

const THREAD_PICKER_MODIFIER_ENTER_LISTENER_OPTIONS = { capture: true } as const;

export function openThreadPicker(host: ThreadPickerHost, onClosed: () => void): ThreadPickerController {
  const state: { closed: boolean; modal: ThreadPickerModal | null } = { closed: false, modal: null };
  const finish = (): void => {
    if (state.closed) return;
    state.closed = true;
    state.modal = null;
    onClosed();
  };
  const loadAndOpen = async (): Promise<void> => {
    try {
      const recentSnapshot = host.threadCatalog.recentActiveThreadsSnapshot();
      const loadedThreads = recentSnapshot ?? (await host.threadCatalog.fetchActiveThreads());
      if (state.closed) return;
      const recentThreads = host.threadCatalog.recentActiveThreadsSnapshot() ?? loadedThreads;
      if (recentThreads.length === 0 && !host.threadCatalog.hasMoreActiveThreads()) {
        new Notice("No Codex threads found.");
        finish();
        return;
      }
      state.modal = new ThreadPickerModal(host, recentThreads, finish);
      state.modal.open();
    } catch (error) {
      if (!state.closed) new Notice(error instanceof Error ? error.message : String(error));
      finish();
    }
  };
  queueMicrotask(() => void loadAndOpen());
  return {
    close: () => {
      if (state.closed) return;
      state.modal?.close();
      finish();
    },
  };
}

function threadPickerSuggestions(threads: readonly Thread[], queryText: string): ThreadSuggestion[] {
  const matches = threadSearchMatches(threads, queryText);
  if (queryText.trim().length === 0) {
    matches.sort(
      (left, right) =>
        Number(right.thread.isPinned === true) - Number(left.thread.isPinned === true) || compareThreadSearchMatches(left, right),
    );
  }
  return matches.map(({ thread, title }) => ({
    thread,
    title,
  }));
}

function threadOpenModeFromEvent(evt: MouseEvent | KeyboardEvent): ThreadOpenMode {
  if (evt instanceof KeyboardEvent && (evt.metaKey || evt.ctrlKey)) return "available";
  return "current";
}

class ThreadPickerModal extends SuggestModal<ThreadSuggestion> {
  private readonly recentThreads: readonly Thread[];
  private completeThreadsPromise: Promise<readonly Thread[]> | null = null;
  private completeThreads: readonly Thread[] | null = null;

  constructor(
    private readonly host: ThreadPickerHost,
    recentThreads: readonly Thread[],
    private readonly onClosed: () => void,
  ) {
    super(host.app);
    this.recentThreads = Object.freeze([...recentThreads]);
    this.emptyStateText = "No matching Codex threads";
    this.setPlaceholder("Open Codex thread...");
    this.setInstructions([
      { command: "↵", purpose: "to open in current panel" },
      { command: Platform.isMacOS ? "⌘ ↵" : "Ctrl ↵", purpose: "to open in new panel" },
    ]);
  }

  override onOpen(): void {
    void super.onOpen();
    this.inputEl.addEventListener("keydown", this.handleInputKeydown, THREAD_PICKER_MODIFIER_ENTER_LISTENER_OPTIONS);
  }

  override onClose(): void {
    this.inputEl.removeEventListener("keydown", this.handleInputKeydown, THREAD_PICKER_MODIFIER_ENTER_LISTENER_OPTIONS);
    super.onClose();
    this.onClosed();
  }

  override async getSuggestions(query: string): Promise<ThreadSuggestion[]> {
    if (query.trim().length === 0) {
      this.emptyStateText = "No matching Codex threads";
      return threadPickerSuggestions(this.recentThreads, query);
    }

    this.emptyStateText = "Searching older Codex threads…";
    this.onNoSuggestion();
    try {
      return threadPickerSuggestions(await this.loadCompleteThreadList(), query);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
      return [];
    } finally {
      this.emptyStateText = "No matching Codex threads";
    }
  }

  override renderSuggestion(value: ThreadSuggestion, el: HTMLElement): void {
    const contentEl = el.createDiv({ cls: "suggestion-content" });
    contentEl.createDiv({ cls: "suggestion-title", text: value.title });
  }

  override onChooseSuggestion(item: ThreadSuggestion, evt: MouseEvent | KeyboardEvent): void {
    void this.openThread(item.thread.id, threadOpenModeFromEvent(evt));
  }

  private readonly handleInputKeydown = (evt: KeyboardEvent): void => {
    if (evt.key !== "Enter" || (!evt.metaKey && !evt.ctrlKey)) return;
    evt.preventDefault();
    evt.stopImmediatePropagation();
    this.selectActiveSuggestion(evt);
  };

  private async openThread(threadId: string, mode: ThreadOpenMode): Promise<void> {
    try {
      if (mode === "available") {
        await this.host.openThreadInAvailableView(threadId);
      } else {
        await this.host.openThreadInCurrentView(threadId);
      }
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
    }
  }

  private async loadCompleteThreadList(): Promise<readonly Thread[]> {
    if (this.completeThreads) return this.completeThreads;
    const pending = this.completeThreadsPromise ?? this.host.threadCatalog.fetchActiveThreadSearchInventory();
    this.completeThreadsPromise = pending;
    try {
      this.completeThreads = Object.freeze([...(await pending)]);
      return this.completeThreads;
    } finally {
      if (this.completeThreadsPromise === pending) this.completeThreadsPromise = null;
    }
  }
}
