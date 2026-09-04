import { Notice } from "obsidian";
import type { Thread } from "../../domain/threads/model";
import { threadRenameDraftTitle } from "../../domain/threads/title";
import { DeferredTask } from "../../shared/async/deferred-task";
import type { ObservedPaginatedResult } from "../../shared/async/observed-result";
import { OwnerLifetime } from "../../shared/async/owner-lifetime";
import type { ThreadCatalogPaginatedActiveReader } from "../threads/catalog/thread-catalog";
import type { ThreadTitlePort } from "../threads/workflows/ports";
import type { ThreadMutationCommands } from "../threads/workflows/thread-mutation-commands";
import { createThreadRenameEditor, type ThreadRenameEditor } from "../threads/workflows/thread-rename-editor";
import { createThreadTitleService, type ThreadTitleService } from "../threads/workflows/thread-title-service";
import { isThreadsArchiveConfirmPointer, renderThreadsViewShell, unmountThreadsViewShell } from "./shell.dom";
import { type ThreadsRenameState, type ThreadsViewPanelActivity, threadRows } from "./state";
export interface ThreadsViewHost {
  readonly settings: ThreadsViewSettingsAccess;
  readonly threadCatalog: ThreadsViewThreadCatalog;
  readonly threadMutations: ThreadMutationCommands;
  readonly threadTitlePort: ThreadTitlePort;
  openNewPanel(): Promise<unknown>;
  openThreadInAvailableView(threadId: string): Promise<void>;
  visiblePanelActivities(threads: readonly Thread[]): readonly ThreadsViewPanelActivity[];
}

type ThreadsViewThreadCatalog = ThreadCatalogPaginatedActiveReader;

export interface ThreadsViewSettingsAccess {
  archiveExportEnabled(): boolean;
}

export interface ThreadsViewSessionEnvironment {
  root: HTMLElement;
  host: ThreadsViewHost;
  registerPointerDown(handler: (event: PointerEvent) => void): void;
  viewWindow(): Window | null;
}

const EMPTY_THREADS_RESULT: ObservedPaginatedResult<readonly Thread[]> = {
  value: null,
  error: null,
  isFetching: false,
  hasMore: false,
  isFetchingNextPage: false,
};

export class ThreadsViewSession {
  private readonly lifetime = new OwnerLifetime();
  private readonly mutations: ThreadMutationCommands;
  private readonly titleService: ThreadTitleService;
  private readonly renameEditor: ThreadRenameEditor;
  private readonly renderTask: DeferredTask;
  private threadsResult = EMPTY_THREADS_RESULT;
  private readonly renameStates = new Map<string, ThreadsRenameState>();
  private readonly lifecycleBusyThreadIds = new Set<string>();
  private unsubscribeThreads: (() => void) | null = null;
  private archiveConfirmThreadId: string | null = null;

  constructor(private readonly environment: ThreadsViewSessionEnvironment) {
    this.renderTask = new DeferredTask(() => this.viewWindow(), 0);
    this.mutations = this.host.threadMutations;
    this.titleService = createThreadTitleService({
      port: this.host.threadTitlePort,
    });
    this.renameEditor = createThreadRenameEditor({
      state: {
        get: (threadId) => this.renameStates.get(threadId),
        replace: (threadId, state) => {
          if (state) this.renameStates.set(threadId, state);
          else this.renameStates.delete(threadId);
          this.render();
        },
        clear: () => {
          this.renameStates.clear();
        },
      },
      initialDraft: (threadId) => {
        const thread = this.threadsResult.value?.find((item) => item.id === threadId);
        return thread ? threadRenameDraftTitle(thread) : null;
      },
      renameThread: (threadId, value, shouldStart) => this.mutations.renameThread(threadId, value, { shouldStart }),
      resolveTitleContext: (threadId) => this.titleService.resolveContext(threadId),
      generateTitle: (context, signal) => this.titleService.generate(context, signal),
      reportError: (error) => {
        this.noticeError(error);
      },
    });
  }

  open(): void {
    this.lifetime.activate();
    this.environment.registerPointerDown((event) => {
      this.cancelArchiveConfirmOnOutsidePointer(event);
    });
    this.unsubscribeThreads = this.host.threadCatalog.observeActiveThreadsResult((result) => {
      this.receiveObservedThreadsResult(result);
    });
    this.render();
    void this.refresh();
  }

  close(): void {
    this.lifetime.dispose();
    this.renameEditor.invalidate();
    this.titleService.invalidate();
    this.renderTask.clear();
    this.unsubscribeThreads?.();
    this.unsubscribeThreads = null;
    unmountThreadsViewShell(this.environment.root);
  }

  async refresh(): Promise<void> {
    await this.requestThreads(() => this.host.threadCatalog.refreshActiveThreads());
  }

  private async requestThreads(request: () => Promise<void>): Promise<void> {
    const lifetime = this.lifetime.signal();
    if (!this.lifetime.isCurrent(lifetime)) return;
    try {
      await request();
    } catch (error) {
      if (!this.lifetime.isCurrent(lifetime)) return;
      if (this.threadsResult.value) {
        this.noticeError(error);
      } else {
        this.threadsResult = {
          ...this.threadsResult,
          error: error instanceof Error ? error : new Error(String(error)),
          isFetching: false,
        };
        this.render();
      }
    }
  }

  async loadMore(): Promise<void> {
    const lifetime = this.lifetime.signal();
    if (!this.lifetime.isCurrent(lifetime) || !this.threadsResult.hasMore || this.threadsResult.isFetching) return;
    try {
      await this.host.threadCatalog.loadMoreActiveThreads();
    } catch (error) {
      if (!this.lifetime.isCurrent(lifetime)) return;
      this.noticeError(error);
    }
  }

  refreshLiveState(): void {
    this.scheduleRender();
  }

  refreshSettings(): void {
    this.render();
  }

  private receiveObservedThreadsResult(result: ObservedPaginatedResult<readonly Thread[]>): void {
    this.threadsResult = result;
    this.render();
  }

  private get host(): ThreadsViewHost {
    return this.environment.host;
  }

  private render(): void {
    if (!this.lifetime.isActive()) return;
    const threads = this.threadsResult.value ?? [];
    const initialError = this.threadsResult.value === null ? this.threadsResult.error : null;
    renderThreadsViewShell(
      this.environment.root,
      {
        status: initialError
          ? { kind: "error", message: initialError.message }
          : this.threadsResult.value === null && this.threadsResult.isFetching
            ? { kind: "loading", message: "Loading threads..." }
            : null,
        loading: this.threadsResult.isFetchingNextPage,
        fetching: this.threadsResult.isFetching,
        hasMore: this.threadsResult.hasMore,
        rows: threadRows(
          threads,
          this.host.visiblePanelActivities(threads),
          this.renameStates,
          this.archiveConfirmThreadId,
          this.host.settings.archiveExportEnabled(),
          this.lifecycleBusyThreadIds,
        ),
      },
      {
        refresh: () => void this.refresh(),
        loadMore: () => void this.loadMore(),
        openNewPanel: () => void this.openNewPanel(),
        openThread: (threadId) => void this.openThread(threadId),
        startRename: (threadId) => {
          this.archiveConfirmThreadId = null;
          this.renameEditor.start(threadId);
        },
        updateRename: (threadId, value) => {
          this.renameEditor.updateDraft(threadId, value);
        },
        saveRename: (threadId, value) => void this.renameEditor.save(threadId, value),
        cancelRename: (threadId) => {
          this.renameEditor.cancel(threadId);
        },
        cancelAutoName: (threadId) => {
          this.renameEditor.cancelAutoName(threadId);
        },
        autoNameThread: (threadId) => void this.renameEditor.autoNameDraft(threadId),
        setThreadPinned: (threadId, isPinned) => void this.setThreadPinned(threadId, isPinned),
        startArchive: (threadId) => {
          this.startArchive(threadId);
        },
        archiveThread: (threadId, saveMarkdown) => void this.archiveThread(threadId, saveMarkdown),
      },
    );
  }

  private scheduleRender(): void {
    this.renderTask.schedule(() => {
      const activeThreadsSnapshot = this.host.threadCatalog.activeThreadsSnapshot();
      if (activeThreadsSnapshot) this.threadsResult = { ...this.threadsResult, value: activeThreadsSnapshot };
      this.render();
    });
  }

  private async openThread(threadId: string): Promise<void> {
    this.archiveConfirmThreadId = null;
    await this.host.openThreadInAvailableView(threadId);
  }

  private async openNewPanel(): Promise<void> {
    await this.host.openNewPanel();
  }

  private startArchive(threadId: string): void {
    this.archiveConfirmThreadId = threadId;
    this.render();
  }

  private async setThreadPinned(threadId: string, isPinned: boolean): Promise<void> {
    const viewLifetime = this.lifetime.signal();
    try {
      await this.mutations.setThreadPinned(threadId, isPinned);
    } catch (error) {
      if (!this.lifetime.isCurrent(viewLifetime)) return;
      this.noticeError(error);
    }
  }

  private cancelArchiveConfirmOnOutsidePointer(event: PointerEvent): void {
    if (!this.archiveConfirmThreadId) return;
    if (isThreadsArchiveConfirmPointer(event, this.environment.root, this.viewWindow())) return;
    this.archiveConfirmThreadId = null;
    this.render();
  }

  private async archiveThread(threadId: string, saveMarkdown: boolean): Promise<void> {
    if (this.lifecycleBusyThreadIds.has(threadId)) return;
    const viewLifetime = this.lifetime.signal();
    this.lifecycleBusyThreadIds.add(threadId);
    this.render();
    try {
      const result = await this.mutations.archiveThread(threadId, {
        saveMarkdown,
      });
      if (!this.lifetime.isCurrent(viewLifetime)) return;
      if (result.kind === "blocked") {
        new Notice("Finish or interrupt the thread before archiving it.");
        return;
      }
      if (result.exportedPath) new Notice(`Saved archived thread to ${result.exportedPath}.`);
      if (this.archiveConfirmThreadId === threadId) this.archiveConfirmThreadId = null;
      this.renameStates.delete(threadId);
    } catch (error) {
      if (!this.lifetime.isCurrent(viewLifetime)) return;
      this.noticeError(error);
    } finally {
      this.lifecycleBusyThreadIds.delete(threadId);
      if (this.lifetime.isCurrent(viewLifetime)) this.render();
    }
  }

  private noticeError(error: unknown): void {
    new Notice(error instanceof Error ? error.message : String(error));
  }

  private viewWindow(): Window {
    return this.environment.viewWindow() ?? window;
  }
}
