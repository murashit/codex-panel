import { type App, Notice, Platform, SuggestModal } from "obsidian";
import { errorMessage } from "../../domain/text/error-message";
import type { Thread } from "../../domain/threads/model";
import { threadSearchMatches } from "../../domain/threads/search";
import { threadDisplayTitle } from "../../domain/threads/title";
import type { ThreadCatalogPaginatedActiveReader, ThreadCatalogSearchReader } from "../threads/catalog/thread-catalog";

export interface ThreadPickerHost {
  readonly app: App;
  readonly threadCatalog: Pick<
    ThreadCatalogPaginatedActiveReader,
    "recentActiveThreadsSnapshot" | "fetchActiveThreads" | "hasMoreActiveThreads" | "observeActiveThreadsResult"
  > &
    ThreadCatalogSearchReader;
  openThreadInCurrentView(threadId: string): Promise<void>;
  openThreadInAvailableView(threadId: string): Promise<void>;
}

export interface ThreadPickerController {
  close(): void;
}

export function openThreadPicker(host: ThreadPickerHost, onClosed: () => void) {
  const modal = new ThreadPickerModal(host, onClosed);
  void modal.openWhenReady();
  return modal;
}

// A catalog update redraws native suggestions without requesting a search.
class CatalogUpdateEvent extends Event {}

class ThreadPickerModal extends SuggestModal<Thread> {
  private phase: "loading" | "open" | "closed" = "loading";
  private stopRecent?: () => void;
  private search?: ReturnType<ThreadCatalogSearchReader["watchActiveThreadSearch"]>;

  constructor(
    private readonly host: ThreadPickerHost,
    private readonly onClosed: () => void,
  ) {
    super(host.app);
    this.setPlaceholder("Open Codex thread...");
    this.setInstructions([
      { command: "↵", purpose: "to open in current panel" },
      { command: Platform.isMacOS ? "⌘ ↵" : "Ctrl ↵", purpose: "to open in new panel" },
    ]);
  }

  async openWhenReady(): Promise<void> {
    try {
      const catalog = this.host.threadCatalog;
      const threads = await (catalog.recentActiveThreadsSnapshot() ?? catalog.fetchActiveThreads());
      if (this.phase === "closed") return;
      if (threads.length > 0 || catalog.hasMoreActiveThreads()) {
        this.phase = "open";
        this.open();
        return;
      }
      new Notice("No Codex threads found.");
    } catch (error) {
      if (this.phase === "closed") return;
      new Notice(errorMessage(error));
    }
    this.close();
  }

  override close(): void {
    if (this.phase === "open") super.close();
    else if (this.phase === "loading") {
      this.phase = "closed";
      this.onClosed();
    }
  }

  override onOpen(): void {
    void super.onOpen();
    this.inputEl.addEventListener("keydown", this.handleInputKeydown, true);
    this.inputEl.addEventListener("input", this.handleSearchInput, true);
    this.stopRecent = this.host.threadCatalog.observeActiveThreadsResult(() => {
      if (!this.inputEl.value.trim()) this.inputEl.dispatchEvent(new CatalogUpdateEvent("input"));
    });
  }

  override onClose(): void {
    this.phase = "closed";
    this.stopRecent?.();
    this.search?.close();
    this.inputEl.removeEventListener("input", this.handleSearchInput, true);
    this.inputEl.removeEventListener("keydown", this.handleInputKeydown, true);
    super.onClose();
    this.onClosed();
  }

  override getSuggestions(query: string): Thread[] {
    this.emptyStateText = "No matching Codex threads";
    if (!query.trim()) return [...(this.host.threadCatalog.recentActiveThreadsSnapshot() ?? [])];
    const result = this.search?.read();
    if (result?.error) this.emptyStateText = errorMessage(result.error);
    else if (result?.isFetching) this.emptyStateText = "Searching older Codex threads…";
    return threadSearchMatches(result?.value ?? [], query).map((match) => match.thread);
  }

  private readonly handleSearchInput = (event: Event): void => {
    if (event instanceof CatalogUpdateEvent || !this.inputEl.value.trim()) return;
    this.search ??= this.host.threadCatalog.watchActiveThreadSearch(() => {
      if (this.inputEl.value.trim()) this.inputEl.dispatchEvent(new CatalogUpdateEvent("input"));
    });
    void this.host.threadCatalog.fetchActiveThreadSearch().catch(() => {
      // The observed search result supplies the error to the modal.
    });
  };

  override renderSuggestion(thread: Thread, el: HTMLElement): void {
    const contentEl = el.createDiv({ cls: "suggestion-content" });
    contentEl.createDiv({ cls: "suggestion-title", text: threadDisplayTitle(thread) });
  }

  override onChooseSuggestion(thread: Thread, evt: MouseEvent | KeyboardEvent): void {
    const opening =
      "key" in evt && (evt.metaKey || evt.ctrlKey)
        ? this.host.openThreadInAvailableView(thread.id)
        : this.host.openThreadInCurrentView(thread.id);
    void opening.catch((error: unknown) => {
      new Notice(errorMessage(error));
    });
  }

  private readonly handleInputKeydown = (evt: KeyboardEvent): void => {
    if (evt.key !== "Enter" || (!evt.metaKey && !evt.ctrlKey)) return;
    evt.preventDefault();
    evt.stopImmediatePropagation();
    this.selectActiveSuggestion(evt);
  };
}
