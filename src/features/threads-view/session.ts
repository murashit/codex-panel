import { Notice } from "obsidian";

import { type AppServerQueryContext, appServerQueryContextRawEquals } from "../../app-server/query/keys";
import type { ObservedResult } from "../../app-server/query/observed-result";
import { observedInitialError, observedInitialLoading } from "../../app-server/query/observed-result";
import { isStaleAppServerResourceContextError } from "../../app-server/query/resource-store";
import type { ReasoningEffort } from "../../domain/catalog/metadata";
import type { ArchiveExportSettings } from "../../domain/threads/archive-markdown";
import type { Thread } from "../../domain/threads/model";
import type { ThreadRenameLifecycleEvent } from "../../domain/threads/rename-lifecycle";
import { DeferredTask } from "../../shared/runtime/deferred-task";
import { OwnerLifetime } from "../../shared/runtime/owner-lifetime";
import type { ThreadCatalogEventSink, ThreadCatalogPaginatedActiveReader } from "../threads/catalog/thread-catalog";
import type { ArchiveExportDestination } from "../threads/workflows/archive-export";
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
  closeOpenPanelsForThread(threadId: string): void;
}

type ThreadsViewThreadCatalog = ThreadCatalogPaginatedActiveReader & ThreadCatalogEventSink;

export interface ThreadsViewSettingsAccess {
  archiveExportEnabled(): boolean;
  codexPath(): string;
  threadNamingModel(): string | null;
  threadNamingEffort(): ReasoningEffort | null;
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

type ThreadsViewStatus =
  | { kind: "idle" }
  | { kind: "loading"; message: string }
  | { kind: "empty"; message: string }
  | { kind: "log"; message: string }
  | { kind: "error"; message: string };

export class ThreadsViewSession {
  private readonly lifetime = new OwnerLifetime();
  private readonly operations: ThreadOperations;
  private readonly titleService: ThreadTitleService;
  private readonly renderTask: DeferredTask;
  private activeRefresh: object | null = null;
  private status: ThreadsViewStatus = { kind: "idle" };
  private threads: readonly Thread[] = [];
  private threadsLoaded = false;
  private readonly renameStates = new Map<string, ThreadsRenameState>();
  private nextRenameGenerationToken = 1;
  private unsubscribeThreads: (() => void) | null = null;
  private archiveConfirmThreadId: string | null = null;
  private observedAppServerContext: AppServerQueryContext;
  private operationGeneration = 0;

  constructor(private readonly environment: ThreadsViewSessionEnvironment) {
    this.observedAppServerContext = this.currentAppServerContext();
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
    void this.refresh();
  }

  close(): void {
    this.lifetime.dispose();
    this.titleService.invalidate();
    this.activeRefresh = null;
    this.renderTask.clear();
    this.unsubscribeThreads?.();
    this.unsubscribeThreads = null;
    unmountThreadsViewShell(this.environment.root);
  }

  async refresh(): Promise<void> {
    const lifetime = this.lifetime.signal();
    if (!this.lifetime.isCurrent(lifetime)) return;
    const refresh = this.startRefresh();
    if (!this.currentThreadsSnapshot()) {
      this.status = { kind: "loading", message: "Loading threads..." };
    }
    this.render();
    try {
      const threads = await this.host.threadCatalog.refreshActive();
      if (!this.lifetime.isCurrent(lifetime) || this.isStaleRefresh(refresh)) return;
      this.threads = threads;
      this.threadsLoaded = true;
      this.status = threads.length === 0 ? { kind: "empty", message: "No threads" } : { kind: "idle" };
    } catch (error) {
      if (!this.lifetime.isCurrent(lifetime)) return;
      if (isStaleAppServerResourceContextError(error)) return;
      if (!this.currentThreadsSnapshot()) {
        this.status = { kind: "error", message: error instanceof Error ? error.message : String(error) };
      }
    } finally {
      this.finishRefresh(refresh);
    }
  }

  async loadMore(): Promise<void> {
    const lifetime = this.lifetime.signal();
    if (!this.lifetime.isCurrent(lifetime) || !this.host.threadCatalog.hasMoreActive() || this.activeRefresh) return;
    const refresh = this.startRefresh();
    this.render();
    try {
      const threads = await this.host.threadCatalog.loadMoreActive();
      if (!this.lifetime.isCurrent(lifetime) || this.isStaleRefresh(refresh)) return;
      this.threads = threads;
      this.threadsLoaded = true;
      this.status = threads.length === 0 ? { kind: "empty", message: "No threads" } : { kind: "idle" };
    } catch (error) {
      if (!this.lifetime.isCurrent(lifetime) || isStaleAppServerResourceContextError(error)) return;
      this.status = { kind: "error", message: error instanceof Error ? error.message : String(error) };
    } finally {
      this.finishRefresh(refresh);
    }
  }

  refreshLiveState(): void {
    this.scheduleRender();
  }

  prepareAppServerContextChange(): void {
    this.operationGeneration += 1;
    this.titleService.invalidate();
    this.activeRefresh = null;
    this.renderTask.clear();
    this.threads = [];
    this.threadsLoaded = false;
    this.renameStates.clear();
    this.archiveConfirmThreadId = null;
    this.status = { kind: "idle" };
    this.render();
  }

  refreshSettings(): void {
    const nextContext = this.currentAppServerContext();
    if (appServerQueryContextRawEquals(this.observedAppServerContext, nextContext)) {
      this.render();
      return;
    }
    this.observedAppServerContext = nextContext;
    const snapshot = this.host.threadCatalog.activeSnapshot();
    this.threads = snapshot ?? [];
    this.threadsLoaded = snapshot !== null;
    this.status = snapshot?.length === 0 ? { kind: "empty", message: "No threads" } : { kind: "idle" };
    this.render();
    void this.refresh();
  }

  private receiveObservedThreads(threads: readonly Thread[]): void {
    this.threads = threads;
    this.threadsLoaded = true;
    this.status = threads.length === 0 ? { kind: "empty", message: "No threads" } : { kind: "idle" };
    this.render();
  }

  private receiveObservedThreadsResult(result: ObservedResult<readonly Thread[]>): void {
    const observedThreads = result.value;
    if (observedThreads) {
      this.receiveObservedThreads(observedThreads);
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

  private startRefresh(): object {
    const refresh = {};
    this.activeRefresh = refresh;
    return refresh;
  }

  private finishRefresh(refresh: object): void {
    if (this.isStaleRefresh(refresh)) return;
    this.activeRefresh = null;
    this.render();
  }

  private isStaleRefresh(refresh: object): boolean {
    return this.activeRefresh !== refresh;
  }

  private render(): void {
    if (!this.lifetime.isActive()) return;
    renderThreadsViewShell(
      this.environment.root,
      {
        status: this.status.kind === "idle" ? null : this.status.message,
        loading: this.activeRefresh !== null,
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
    this.archiveConfirmThreadId = null;
    this.transitionRenameState(threadId, { type: "started", draft: value });
    this.render();
  }

  private updateRename(threadId: string, value: string): void {
    this.transitionRenameState(threadId, { type: "draft-updated", draft: value });
    this.render();
  }

  private cancelRename(threadId: string): void {
    this.transitionRenameState(threadId, { type: "cancelled" });
    this.render();
  }

  private async saveRename(threadId: string, value: string): Promise<void> {
    const lifetime = this.lifetime.signal();
    const operationGeneration = this.operationGeneration;
    const editingState = this.renameStates.get(threadId);
    if (!editingState || editingState.kind === "generating") return;
    try {
      if (this.renameStates.get(threadId) !== editingState) return;
      const operationIsCurrent = () => operationGeneration === this.operationGeneration;
      const result = await this.operations.renameThread(threadId, value, {
        shouldStart: operationIsCurrent,
        shouldPublish: operationIsCurrent,
      });
      if (!operationIsCurrent()) return;
      if (!this.lifetime.isCurrent(lifetime) || this.renameStates.get(threadId) !== editingState) return;
      if (!result) {
        this.cancelRename(threadId);
        return;
      }
      this.renameStates.delete(threadId);
      this.render();
    } catch (error) {
      if (!this.lifetime.isCurrent(lifetime)) return;
      this.status = { kind: "error", message: error instanceof Error ? error.message : String(error) };
      this.render();
    }
  }

  private async autoNameThread(threadId: string): Promise<void> {
    const lifetime = this.lifetime.signal();
    const operationGeneration = this.operationGeneration;
    const previousState = this.renameStates.get(threadId);
    const generationToken = this.nextRenameGenerationToken;
    const generatingState = this.transitionRenameState(threadId, {
      type: "generation-started",
      generationToken,
    });
    if (generatingState === previousState || generatingState?.kind !== "generating") return;
    this.nextRenameGenerationToken += 1;
    this.render();

    try {
      if (this.renameStates.get(threadId) !== generatingState) return;
      const title = await this.titleService.generateTitle(threadId);
      if (!this.lifetime.isCurrent(lifetime) || operationGeneration !== this.operationGeneration) return;
      this.transitionRenameState(threadId, { type: "generation-succeeded", generationToken, draft: title });
    } catch (error) {
      if (!this.lifetime.isCurrent(lifetime) || operationGeneration !== this.operationGeneration) return;
      if (this.renameStates.get(threadId) === generatingState) {
        this.status = { kind: "error", message: error instanceof Error ? error.message : String(error) };
      }
    } finally {
      if (this.lifetime.isCurrent(lifetime) && operationGeneration === this.operationGeneration) {
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
    const lifetime = this.lifetime.signal();
    const operationGeneration = this.operationGeneration;
    try {
      await this.operations.archiveThread(threadId, {
        saveMarkdown,
        shouldPublish: () => operationGeneration === this.operationGeneration,
      });
      if (!this.lifetime.isCurrent(lifetime) || operationGeneration !== this.operationGeneration) return;
      this.host.closeOpenPanelsForThread(threadId);
      if (this.archiveConfirmThreadId === threadId) this.archiveConfirmThreadId = null;
      this.renameStates.delete(threadId);
    } catch (error) {
      if (!this.lifetime.isCurrent(lifetime)) return;
      this.status = { kind: "error", message: error instanceof Error ? error.message : String(error) };
      this.render();
    }
  }

  private finishAutoNameThread(threadId: string, generationToken: number): void {
    const previousState = this.renameStates.get(threadId);
    const nextState = this.transitionRenameState(threadId, { type: "generation-finished", generationToken });
    if (nextState !== previousState) this.render();
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

  private currentAppServerContext(): AppServerQueryContext {
    return { codexPath: this.host.settings.codexPath(), vaultPath: this.host.vaultPath };
  }
}
