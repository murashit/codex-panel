import { Notice } from "obsidian";
import type { Thread } from "../../domain/threads/model";
import type { ThreadRenameLifecycleEvent } from "../../domain/threads/rename-lifecycle";
import { DeferredTask } from "../../shared/runtime/deferred-task";
import { isStaleExecutionRuntimeError } from "../../shared/runtime/execution-runtime-lifetime";
import type { KeyedOperationCoordinator } from "../../shared/runtime/keyed-operation-coordinator";
import type { ObservedPaginatedResult } from "../../shared/runtime/observed-result";
import { observedInitialError, observedInitialLoading } from "../../shared/runtime/observed-result";
import { OwnerLifetime } from "../../shared/runtime/owner-lifetime";
import type { ThreadCatalogPaginatedActiveReader } from "../threads/catalog/thread-catalog";
import type { ArchiveExportDestination, ArchiveExportSettings } from "../threads/workflows/archive-export";
import type { ThreadMutationPort, ThreadTitlePort } from "../threads/workflows/ports";
import type { ThreadFactSink } from "../threads/workflows/thread-facts";
import { createThreadMutationCommands, type ThreadMutationCommands } from "../threads/workflows/thread-mutation-commands";
import { createThreadTitleService, type ThreadTitleService } from "../threads/workflows/thread-title-service";
import { isThreadsArchiveConfirmPointer, renderThreadsViewShell, unmountThreadsViewShell } from "./shell.dom";
import { type ThreadsRenameState, type ThreadsViewPanelActivity, threadRows, transitionThreadsRenameState } from "./state";
export interface ThreadsViewHost {
  readonly settings: ThreadsViewSettingsAccess;
  readonly vaultPath: string;
  readonly threadCatalog: ThreadsViewThreadCatalog;
  readonly threadFacts: ThreadFactSink;
  readonly threadNameMutations: KeyedOperationCoordinator<string>;
  readonly threadMutationPort: ThreadMutationPort;
  readonly threadTitlePort: ThreadTitlePort;
  openNewPanel(): Promise<unknown>;
  openThreadInAvailableView(threadId: string): Promise<void>;
  openPanelActivities(): readonly ThreadsViewPanelActivity[];
}

type ThreadsViewThreadCatalog = ThreadCatalogPaginatedActiveReader;

export interface ThreadsViewSettingsAccess {
  archiveExportEnabled(): boolean;
  archiveExportSettings(): ArchiveExportSettings;
}

export interface ThreadsViewSessionEnvironment {
  root: HTMLElement;
  host: ThreadsViewHost;
  registerPointerDown(handler: (event: PointerEvent) => void): void;
  archiveDestination(): ArchiveExportDestination;
  vaultConfigDir(): string;
  viewWindow(): Window | null;
}

type ThreadsViewStatus = { kind: "idle" } | { kind: "loading"; message: string } | { kind: "error"; message: string };

interface ThreadTitleContextPreparation {
  readonly threadId: string;
}

interface ThreadTitleGeneration {
  readonly controller: AbortController;
}

export class ThreadsViewSession {
  private readonly lifetime = new OwnerLifetime();
  private readonly mutations: ThreadMutationCommands;
  private readonly titleService: ThreadTitleService;
  private readonly renderTask: DeferredTask;
  private observedFetching = false;
  private observedFetchingNextPage = false;
  private status: ThreadsViewStatus = { kind: "idle" };
  private threads: readonly Thread[] = [];
  private threadsLoaded = false;
  private readonly renameStates = new Map<string, ThreadsRenameState>();
  private readonly renameContextPreparations = new Map<string, ThreadTitleContextPreparation>();
  private readonly renameGenerations = new Map<string, ThreadTitleGeneration>();
  private readonly renameSaves = new Map<string, object>();
  private readonly lifecycleBusyThreadIds = new Set<string>();
  private unsubscribeThreads: (() => void) | null = null;
  private archiveConfirmThreadId: string | null = null;

  constructor(private readonly environment: ThreadsViewSessionEnvironment) {
    this.renderTask = new DeferredTask(() => this.viewWindow(), 0);
    this.mutations = createThreadMutationCommands({
      port: this.host.threadMutationPort,
      nameMutations: this.host.threadNameMutations,
      archiveExport: {
        settings: () => this.host.settings.archiveExportSettings(),
        enabled: () => this.host.settings.archiveExportEnabled(),
        vaultPath: this.host.vaultPath,
        vaultConfigDir: this.environment.vaultConfigDir(),
      },
      archiveDestination: () => this.environment.archiveDestination(),
      facts: this.host.threadFacts,
      referenceThreads: () => this.threads,
      notice: (message) => {
        new Notice(message);
      },
    });
    this.titleService = createThreadTitleService({
      port: this.host.threadTitlePort,
    });
  }

  open(): void {
    this.lifetime.activate();
    this.environment.registerPointerDown((event) => {
      this.cancelArchiveConfirmOnOutsidePointer(event);
    });
    const activeThreadsSnapshot = this.host.threadCatalog.activeThreadsSnapshot();
    if (activeThreadsSnapshot) {
      this.threads = activeThreadsSnapshot;
      this.threadsLoaded = true;
    }
    this.unsubscribeThreads = this.host.threadCatalog.observeActiveThreadsResult((result) => {
      this.receiveObservedThreadsResult(result);
    });
    this.render();
    void this.refresh();
  }

  close(): void {
    this.lifetime.dispose();
    for (const operation of this.renameGenerations.values()) operation.controller.abort();
    this.renameGenerations.clear();
    this.renameSaves.clear();
    this.renameContextPreparations.clear();
    this.titleService.invalidate();
    this.observedFetching = false;
    this.observedFetchingNextPage = false;
    this.renderTask.clear();
    this.unsubscribeThreads?.();
    this.unsubscribeThreads = null;
    unmountThreadsViewShell(this.environment.root);
  }

  async refresh(): Promise<void> {
    await this.requestThreads(() => this.host.threadCatalog.refreshActiveThreads());
  }

  private async requestThreads(request: () => Promise<readonly Thread[]>): Promise<void> {
    const lifetime = this.lifetime.signal();
    if (!this.lifetime.isCurrent(lifetime)) return;
    try {
      await request();
    } catch (error) {
      if (!this.lifetime.isCurrent(lifetime) || isStaleExecutionRuntimeError(error)) return;
      if (!this.currentThreadsSnapshot()) {
        this.status = { kind: "error", message: error instanceof Error ? error.message : String(error) };
        this.render();
      } else {
        this.noticeError(error);
      }
    }
  }

  async loadMore(): Promise<void> {
    const lifetime = this.lifetime.signal();
    if (!this.lifetime.isCurrent(lifetime) || !this.host.threadCatalog.hasMoreActiveThreads() || this.observedFetching) return;
    try {
      await this.host.threadCatalog.loadMoreActiveThreads();
    } catch (error) {
      if (!this.lifetime.isCurrent(lifetime) || isStaleExecutionRuntimeError(error)) return;
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
    this.observedFetching = result.isFetching;
    this.observedFetchingNextPage = result.isFetchingNextPage;
    const observedThreads = result.value;
    if (observedThreads) {
      const hadThreadsSnapshot = this.currentThreadsSnapshot() !== null;
      this.threads = observedThreads;
      this.threadsLoaded = true;
      this.status = result.error && !hadThreadsSnapshot ? { kind: "error", message: result.error.message } : { kind: "idle" };
      this.render();
      return;
    }
    const currentValue = this.currentThreadsSnapshot();
    if (observedInitialLoading(result, currentValue)) {
      this.status = { kind: "loading", message: "Loading threads..." };
      this.render();
      return;
    }
    const initialError = observedInitialError(result, currentValue);
    if (initialError) {
      this.status = { kind: "error", message: initialError.message };
      this.render();
    }
  }

  private currentThreadsSnapshot(): readonly Thread[] | null {
    return this.threadsLoaded ? this.threads : null;
  }

  private get host(): ThreadsViewHost {
    return this.environment.host;
  }

  private render(): void {
    if (!this.lifetime.isActive()) return;
    renderThreadsViewShell(
      this.environment.root,
      {
        status: this.status.kind === "idle" ? null : this.status,
        loading: this.observedFetchingNextPage,
        fetching: this.observedFetching,
        hasMore: this.host.threadCatalog.hasMoreActiveThreads(),
        rows: threadRows(
          this.threads,
          this.host.openPanelActivities(),
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
        startRename: (threadId, value) => {
          this.startRename(threadId, value);
        },
        updateRename: (threadId, value) => {
          this.updateRename(threadId, value);
        },
        saveRename: (threadId, value) => void this.saveRename(threadId, value),
        cancelRename: (threadId) => {
          this.cancelRename(threadId);
        },
        cancelAutoName: (threadId) => {
          this.cancelAutoName(threadId);
        },
        autoNameThread: (threadId) => void this.autoNameThread(threadId),
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

  private startRename(threadId: string, value: string): void {
    const current = this.renameStates.get(threadId);
    if (current?.kind === "saving") return;
    this.archiveConfirmThreadId = null;
    this.transitionRenameState(threadId, { type: "started", draft: value });
    this.render();
    void this.prepareAutoName(threadId);
  }

  private updateRename(threadId: string, value: string): void {
    this.transitionRenameState(threadId, { type: "draft-updated", draft: value });
    this.render();
  }

  private cancelRename(threadId: string): void {
    if (this.renameStates.get(threadId)?.kind === "saving") return;
    this.abortAutoName(threadId);
    this.renameContextPreparations.delete(threadId);
    this.transitionRenameState(threadId, { type: "cancelled" });
    this.render();
  }

  private cancelAutoName(threadId: string): void {
    const state = this.renameStates.get(threadId);
    if (state?.kind !== "generating") return;
    this.abortAutoName(threadId);
    this.finishAutoNameThread(threadId);
  }

  private async saveRename(threadId: string, value: string): Promise<void> {
    const viewLifetime = this.lifetime.signal();
    const previousState = this.renameStates.get(threadId);
    if (previousState?.kind !== "editing") return;
    const savingState = this.transitionRenameState(threadId, { type: "save-started" });
    if (savingState === previousState || savingState?.kind !== "saving") return;
    const operation = {};
    this.renameSaves.set(threadId, operation);
    this.render();
    try {
      await this.mutations.renameThread(threadId, value, {
        shouldStart: () => this.lifetime.isCurrent(viewLifetime) && this.renameSaves.get(threadId) === operation,
      });
      if (!this.lifetime.isCurrent(viewLifetime)) return;
      const currentState = this.renameStates.get(threadId);
      if (this.renameSaves.get(threadId) !== operation || currentState?.kind !== "saving") return;
      this.renameSaves.delete(threadId);
      const nextState = this.transitionRenameState(threadId, { type: "save-succeeded" });
      if (nextState !== currentState) {
        if (!nextState) this.renameContextPreparations.delete(threadId);
        this.render();
      }
    } catch (error) {
      if (
        !this.lifetime.isCurrent(viewLifetime) ||
        this.renameSaves.get(threadId) !== operation ||
        this.renameStates.get(threadId)?.kind !== "saving"
      ) {
        return;
      }
      this.renameSaves.delete(threadId);
      this.noticeError(error);
      this.transitionRenameState(threadId, { type: "save-failed" });
      this.render();
    }
  }

  private async autoNameThread(threadId: string): Promise<void> {
    const viewLifetime = this.lifetime.signal();
    const previousState = this.renameStates.get(threadId);
    const generatingState = this.transitionRenameState(threadId, { type: "generation-started" });
    if (generatingState === previousState || generatingState?.kind !== "generating") return;
    const controller = new AbortController();
    const operation = { controller };
    this.renameGenerations.set(threadId, operation);
    this.render();

    try {
      const context = generatingState.autoName.context;
      const title = await this.titleService.generate(context, controller.signal);
      if (!title) throw new Error("Codex did not return a usable thread title.");
      if (!this.lifetime.isCurrent(viewLifetime) || this.renameGenerations.get(threadId) !== operation) return;
      this.transitionRenameState(threadId, { type: "generation-succeeded", draft: title });
    } catch (error) {
      if (!this.lifetime.isCurrent(viewLifetime)) return;
      if (this.renameStates.get(threadId) === generatingState) {
        this.noticeError(error);
      }
    } finally {
      if (this.renameGenerations.get(threadId) === operation) {
        this.renameGenerations.delete(threadId);
        if (this.lifetime.isCurrent(viewLifetime)) this.finishAutoNameThread(threadId);
      }
    }
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
    const panelActivity = this.host.openPanelActivities().find((activity) => activity.threadId === threadId);
    if (panelActivity?.pending || panelActivity?.running) {
      new Notice("Finish or interrupt the thread before archiving it.");
      return;
    }
    const viewLifetime = this.lifetime.signal();
    this.lifecycleBusyThreadIds.add(threadId);
    this.render();
    try {
      await this.mutations.archiveThread(threadId, {
        saveMarkdown,
      });
      if (!this.lifetime.isCurrent(viewLifetime)) return;
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

  private finishAutoNameThread(threadId: string): void {
    const previousState = this.renameStates.get(threadId);
    const nextState = this.transitionRenameState(threadId, { type: "generation-finished" });
    if (nextState !== previousState) this.render();
  }

  private async prepareAutoName(threadId: string): Promise<void> {
    const preparation = { threadId };
    this.renameContextPreparations.set(threadId, preparation);
    let context = null;
    try {
      context = await this.titleService.resolveContext(threadId);
    } catch {
      // Auto-name availability is reflected by the disabled action.
    }
    if (!this.lifetime.isActive() || this.renameContextPreparations.get(threadId) !== preparation) return;
    this.renameContextPreparations.delete(threadId);
    const state = this.renameStates.get(threadId);
    if (state?.kind !== "editing" && state?.kind !== "saving") return;
    this.transitionRenameState(threadId, { type: "auto-name-context-resolved", context });
    this.render();
  }

  private abortAutoName(threadId: string): void {
    this.renameGenerations.get(threadId)?.controller.abort();
    this.renameGenerations.delete(threadId);
  }

  private transitionRenameState(threadId: string, event: ThreadRenameLifecycleEvent): ThreadsRenameState | undefined {
    const nextState = transitionThreadsRenameState(this.renameStates.get(threadId), event);
    if (nextState) {
      this.renameStates.set(threadId, nextState);
    } else {
      this.renameStates.delete(threadId);
    }
    return nextState;
  }

  private viewWindow(): Window {
    return this.environment.viewWindow() ?? window;
  }
}
