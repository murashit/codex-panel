import { Notice, Platform, SuggestModal, type App } from "obsidian";

import { listPanelThreads } from "../../app-server/panel-data";
import { withShortLivedAppServerClient } from "../../app-server/short-lived-client";
import { getThreadTitle } from "../../domain/threads/model";
import type { PanelThread } from "../../domain/threads/model";
import type { CodexPanelSettings } from "../../settings/model";
import { shortThreadId } from "../../utils";

export interface ThreadPickerHost {
  readonly app: App;
  readonly settings: CodexPanelSettings;
  readonly vaultPath: string;
  cachedThreadList(): readonly PanelThread[] | null;
  refreshThreadList(fetchThreads: () => Promise<readonly PanelThread[]>): Promise<readonly PanelThread[]>;
  openThreadInCurrentView(threadId: string): Promise<void>;
  openThreadInAvailableView(threadId: string): Promise<void>;
}

interface ThreadSuggestion {
  thread: PanelThread;
  title: string;
}

type ThreadOpenMode = "current" | "available";

const MAX_THREAD_PICKER_SUGGESTIONS = 20;

const THREAD_PICKER_MODIFIER_ENTER_LISTENER_OPTIONS = { capture: true } as const;

export async function openThreadPicker(host: ThreadPickerHost): Promise<void> {
  try {
    const threads = await loadThreadPickerThreads(host);
    if (threads.length === 0) {
      new Notice("No Codex threads found.");
      return;
    }
    new ThreadPickerModal(host, threads).open();
  } catch (error) {
    new Notice(error instanceof Error ? error.message : String(error));
  }
}

export function threadPickerSuggestions(threads: readonly PanelThread[], queryText: string): ThreadSuggestion[] {
  const query = queryText.trim().toLowerCase();
  return [...threads]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((thread, index) => {
      const title = getThreadTitle(thread);
      const id = thread.id.toLowerCase();
      const normalizedTitle = title.toLowerCase();
      const shortId = shortThreadId(thread.id).toLowerCase();
      const score =
        query.length === 0
          ? 3
          : normalizedTitle.startsWith(query)
            ? 0
            : id.startsWith(query) || shortId.startsWith(query)
              ? 1
              : normalizedTitle.includes(query)
                ? 2
                : id.includes(query)
                  ? 3
                  : -1;
      return { thread, title, score, index };
    })
    .filter((item) => item.score !== -1)
    .sort((a, b) => a.score - b.score || b.thread.updatedAt - a.thread.updatedAt || a.index - b.index)
    .slice(0, MAX_THREAD_PICKER_SUGGESTIONS)
    .map(({ thread, title }) => ({
      thread,
      title,
    }));
}

export function threadOpenModeFromEvent(evt: MouseEvent | KeyboardEvent): ThreadOpenMode {
  if (evt instanceof KeyboardEvent && (evt.metaKey || evt.ctrlKey)) return "available";
  return "current";
}

async function loadThreadPickerThreads(host: ThreadPickerHost): Promise<readonly PanelThread[]> {
  const cached = host.cachedThreadList();
  if (cached) return cached;

  return withShortLivedAppServerClient(
    host.settings.codexPath,
    host.vaultPath,
    async (client) =>
      host.refreshThreadList(async () => {
        return listPanelThreads(client, host.vaultPath);
      }),
    {
      unhandledServerRequestMessage: "Codex thread picker does not handle server requests.",
    },
  );
}

class ThreadPickerModal extends SuggestModal<ThreadSuggestion> {
  constructor(
    private readonly host: ThreadPickerHost,
    private readonly threads: readonly PanelThread[],
  ) {
    super(host.app);
    this.limit = MAX_THREAD_PICKER_SUGGESTIONS;
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
  }

  override getSuggestions(query: string): ThreadSuggestion[] {
    return threadPickerSuggestions(this.threads, query);
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
}
