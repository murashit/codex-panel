import { Notice } from "obsidian";

import type { ObservedPaginatedResult } from "../../app-server/query/observed-result";
import { observedInitialError, observedInitialLoading } from "../../app-server/query/observed-result";
import type { Thread } from "../../domain/threads/model";
import type { ThreadRenameLifecycleEvent } from "../../domain/threads/rename-lifecycle";
import { DeferredTask } from "../../shared/runtime/deferred-task";
import { isStaleExecutionRuntimeError } from "../../shared/runtime/execution-runtime-lifetime";
import { OwnerLifetime } from "../../shared/runtime/owner-lifetime";
import type { ThreadCatalogEventSink, ThreadCatalogPaginatedActiveReader } from "../threads/catalog/thread-catalog";
import type { ArchiveExportDestination, ArchiveExportSettings } from "../threads/workflows/archive-export";
import type { ThreadOperationsTransport, ThreadTitleTransport } from "../threads/workflows/ports";
import type { ThreadNameMutationCoordinator } from "../threads/workflows/thread-name-mutation-coordinator";
import { createThreadOperations, type ThreadOperations } from "../threads/workflows/thread-operations";
import { createThreadTitleService, type ThreadTitleService } from "../threads/workflows/thread-title-service";
import { isThreadsArchiveConfirmPointer, renderThreadsViewShell, unmountThreadsViewShell } from "./shell.dom";
import { type ThreadsRenameState, type ThreadsViewPanelActivity, threadRows, transitionThreadsRenameState } from "./state";
export interface ThreadsViewHost {
  readonly settings: ThreadsViewSettingsAccess;
  readonly vaultPath: string;
  readonly threadCatalog: ThreadsViewThreadCatalog;
  readonly threadNameMutations: ThreadNameMutationCoordinator;
  readonly threadOperationsTransport: ThreadOperationsTransport;
  readonly threadTitleTransport: ThreadTitleTransport;
  openNewPanel(): Promise<unknown>;
  openThreadInAvailableView(threadId: string): Promise<void>;
  openPanelActivities(): readonly ThreadsViewPanelActivity[];
}

type ThreadsViewThreadCatalog = ThreadCatalogPaginatedActiveReader & ThreadCatalogEventSink;

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

interface ThreadsViewOperationLease {
  readonly lifetime: AbortSignal;
}

interface ThreadTitleContextPreparation {
  readonly threadId: string;
}

export class ThreadsViewSession {
  private readonly lifetime = new OwnerLifetime();
  private readonly operations: ThreadOperations;
  private readonly titleService: ThreadTitleService;
  private readonly renderTask: DeferredTask;
  private observedFetching = false;
  private observedFetchingNextPage = false;
  private status: ThreadsViewStatus = { kind: "idle" };
  private threads: readonly Thread[] = [];
  private threadsLoaded = false;
  private readonly renameStates = new Map<string, ThreadsRenameState>();
  private readonly renameContextPreparations = new Map<string, ThreadTitleContextPreparation>();
  private readonly renameGenerationControllers = new Map<string, { generationToken: number; controller: AbortController }>();
  private nextRenameGenerationToken = 1;
  private nextRenameSaveToken = 1;
  private unsubscribeThreads: (() => void) | null = null;
  private archiveConfirmThreadId: string | null = null;

  constructor(private readonly environment: ThreadsViewSessionEnvironment) {
    this.renderTask = new DeferredTask(() => this.viewWindow(), 0);
    this.operations = createThreadOperations({
      transport: this.host.threadOperationsTransport,
      nameMutations: this.host.threadNameMutations,
      archiveExport: {
        settings: () => this.host.settings.archiveExportSettings(),
        enabled: () => this.host.settings.archiveExportEnabled(),
        vaultPath: this.host.vaultPath,
        vaultConfigDir: this.environment.vaultConfigDir(),
      },
      archiveDestination: () => this.environment.archiveDestination(),
      catalog: this.host.threadCatalog,
      referenceThreads: () => this.threads,
      notice: (message) => {
        new Notice(message);
      },
    });
    this.titleService = createThreadTitleService({
      transport: this.host.threadTitleTransport,
    });
  }

  open(): void {
    this.lifetime.activate();
    this.environment.registerPointerDown((event) => {
      this.cancelArchiveConfirmOnOutsidePointer(event);
    });
    const activeThreadsSnapshot = this.host.threadCatalog.activeSnapshot();
    if (activeThreadsSnapshot) {
      this.threads = activeThreadsSnapshot;
      this.threadsLoaded = true;
    }
    this.unsubscribeThreads = this.host.threadCatalog.observeActive((result) => {
      this.receiveObservedThreadsResult(result);
    });
    this.render();
    void this.load();
  }

  close(): void {
    this.lifetime.dispose();
    for (const operation of this.renameGenerationControllers.values()) operation.controller.abort();
    this.renameGenerationControllers.clear();
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
    await this.requestThreads(() => this.host.threadCatalog.refreshActive());
  }

  private async load(): Promise<void> {
    await this.requestThreads(() => this.host.threadCatalog.loadActive());
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
    if (!this.lifetime.isCurrent(lifetime) || !this.host.threadCatalog.hasMoreActive() || this.observedFetching) return;
    try {
      await this.host.threadCatalog.loadMoreActive();
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
        hasMore: this.host.threadCatalog.hasMoreActive(),
        rows: threadRows(
          this.threads,
          this.host.openPanelActivities(),
          this.renameStates,
          this.archiveConfirmThreadId,
          this.host.settings.archiveExportEnabled(),
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
    this.finishAutoNameThread(threadId, state.generationToken);
  }

  private async saveRename(threadId: string, value: string): Promise<void> {
    const lease = this.captureOperationLease();
    const previousState = this.renameStates.get(threadId);
    if (previousState?.kind !== "editing") return;
    const saveToken = this.nextRenameSaveToken;
    const savingState = this.transitionRenameState(threadId, { type: "save-started", saveToken });
    if (savingState === previousState || savingState?.kind !== "saving") return;
    this.nextRenameSaveToken += 1;
    this.render();
    try {
      await this.operations.renameThread(threadId, value, {
        shouldStart: () => this.operationContextIsCurrent(lease) && this.renameSaveStillActive(threadId, saveToken),
        shouldPublish: () => this.operationContextIsCurrent(lease) && this.renameSaveStillActive(threadId, saveToken),
      });
      if (!this.operationViewIsCurrent(lease)) return;
      const currentState = this.renameStates.get(threadId);
      const nextState = this.transitionRenameState(threadId, { type: "save-succeeded", saveToken });
      if (nextState !== currentState) {
        if (!nextState) this.renameContextPreparations.delete(threadId);
        this.render();
      }
    } catch (error) {
      if (!this.operationViewIsCurrent(lease) || !this.renameSaveStillActive(threadId, saveToken)) return;
      this.noticeError(error);
      this.transitionRenameState(threadId, { type: "save-failed", saveToken });
      this.render();
    }
  }

  private async autoNameThread(threadId: string): Promise<void> {
    const lease = this.captureOperationLease();
    const previousState = this.renameStates.get(threadId);
    const generationToken = this.nextRenameGenerationToken;
    const generatingState = this.transitionRenameState(threadId, {
      type: "generation-started",
      generationToken,
    });
    if (generatingState === previousState || generatingState?.kind !== "generating") return;
    this.nextRenameGenerationToken += 1;
    const controller = new AbortController();
    this.renameGenerationControllers.set(threadId, { generationToken, controller });
    this.render();

    try {
      const context = generatingState.autoName.context;
      const title = await this.titleService.generate(context, controller.signal);
      if (!title) throw new Error("Codex did not return a usable thread title.");
      if (!this.operationViewIsCurrent(lease)) return;
      this.transitionRenameState(threadId, { type: "generation-succeeded", generationToken, draft: title });
    } catch (error) {
      if (!this.operationViewIsCurrent(lease)) return;
      if (this.renameStates.get(threadId) === generatingState) {
        this.noticeError(error);
      }
    } finally {
      const operation = this.renameGenerationControllers.get(threadId);
      if (operation?.generationToken === generationToken) this.renameGenerationControllers.delete(threadId);
      if (this.operationViewIsCurrent(lease)) {
        this.finishAutoNameThread(threadId, generationToken);
      }
    }
  }

  private startArchive(threadId: string): void {
    this.archiveConfirmThreadId = threadId;
    this.render();
  }

  private cancelArchiveConfirmOnOutsidePointer(event: PointerEvent): void {
    if (!this.archiveConfirmThreadId) return;
    if (isThreadsArchiveConfirmPointer(event, this.environment.root, this.viewWindow())) return;
    this.archiveConfirmThreadId = null;
    this.render();
  }

  private async archiveThread(threadId: string, saveMarkdown: boolean): Promise<void> {
    if (this.host.openPanelActivities().some((activity) => activity.threadId === threadId && (activity.pending || activity.running))) {
      new Notice("Finish or interrupt the thread before archiving it.");
      return;
    }
    const lease = this.captureOperationLease();
    try {
      await this.operations.archiveThread(threadId, {
        saveMarkdown,
        shouldPublish: () => this.operationContextIsCurrent(lease),
      });
      if (!this.operationViewIsCurrent(lease)) return;
      if (this.archiveConfirmThreadId === threadId) this.archiveConfirmThreadId = null;
      this.renameStates.delete(threadId);
    } catch (error) {
      if (!this.operationViewIsCurrent(lease)) return;
      this.noticeError(error);
    }
  }

  private captureOperationLease(): ThreadsViewOperationLease {
    return { lifetime: this.lifetime.signal() };
  }

  private operationContextIsCurrent(lease: ThreadsViewOperationLease): boolean {
    return this.lifetime.isCurrent(lease.lifetime);
  }

  private operationViewIsCurrent(lease: ThreadsViewOperationLease): boolean {
    return this.lifetime.isCurrent(lease.lifetime);
  }

  private noticeError(error: unknown): void {
    new Notice(error instanceof Error ? error.message : String(error));
  }

  private finishAutoNameThread(threadId: string, generationToken: number): void {
    const previousState = this.renameStates.get(threadId);
    const nextState = this.transitionRenameState(threadId, { type: "generation-finished", generationToken });
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
    this.renameGenerationControllers.get(threadId)?.controller.abort();
    this.renameGenerationControllers.delete(threadId);
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

  private renameSaveStillActive(threadId: string, saveToken: number): boolean {
    const current = this.renameStates.get(threadId);
    return current?.kind === "saving" && current.saveToken === saveToken;
  }

  private viewWindow(): Window {
    return this.environment.viewWindow() ?? window;
  }
}
