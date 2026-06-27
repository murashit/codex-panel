import { Notice } from "obsidian";

import type { AppServerClientAccess } from "../../app-server/connection/client-access";
import { isStaleAppServerSharedQueryContextError } from "../../app-server/query/shared-queries";
import type { ArchiveExportDestination } from "../../app-server/services/thread-archive-markdown";
import type { ThreadCatalogActiveReader, ThreadCatalogEventSink } from "../../app-server/thread-catalog";
import type { ReasoningEffort } from "../../domain/catalog/metadata";
import type { ObservedResult } from "../../domain/observed-result";
import { observedInitialError, observedInitialLoading, observedValue } from "../../domain/observed-result";
import type { ArchiveExportSettings } from "../../domain/threads/archive-markdown";
import type { Thread } from "../../domain/threads/model";
import type { OpenCodexPanelSnapshot } from "../../workspace/panel-coordinator";
import { createThreadOperations, type ThreadOperations } from "../threads/thread-operations";
import { createThreadTitleService, type ThreadTitleService } from "../threads/thread-title-service";
import { isThreadsArchiveConfirmPointer, renderThreadsViewShell, unmountThreadsViewShell } from "./shell.dom";
import {
  type ThreadsGeneratingRenameState,
  type ThreadsRenameLifecycleEvent,
  type ThreadsRenameState,
  threadRows,
  transitionThreadsRenameState,
} from "./state";
import {
  type ActiveThreadsViewRefresh,
  createThreadsViewDeferredTasks,
  type ThreadsViewDeferredTasks,
  type ThreadsViewRefreshLifecycleState,
  transitionThreadsViewRefreshLifecycle,
} from "./view-lifecycle";

export interface ThreadsViewHost {
  readonly settings: ThreadsViewSettingsAccess;
  readonly vaultPath: string;
  readonly clientAccess: AppServerClientAccess;
  readonly threadCatalog: ThreadsViewThreadCatalog;
  openNewPanel(): Promise<unknown>;
  openThreadInAvailableView(threadId: string): Promise<void>;
  getOpenPanelSnapshots(): OpenCodexPanelSnapshot[];
}

type ThreadsViewThreadCatalog = ThreadCatalogActiveReader & ThreadCatalogEventSink;

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
  private readonly operations: ThreadOperations;
  private readonly titleService: ThreadTitleService;
  private readonly deferredTasks: ThreadsViewDeferredTasks;
  private refreshLifecycle: ThreadsViewRefreshLifecycleState = { kind: "idle" };
  private status: ThreadsViewStatus = { kind: "idle" };
  private threads: readonly Thread[] = [];
  private threadsLoaded = false;
  private readonly renameStates = new Map<string, ThreadsRenameState>();
  private nextRenameGenerationToken = 1;
  private unsubscribeThreads: (() => void) | null = null;
  private archiveConfirmThreadId: string | null = null;

  constructor(private readonly environment: ThreadsViewSessionEnvironment) {
    this.deferredTasks = createThreadsViewDeferredTasks(() => this.viewWindow());
    this.operations = createThreadOperations({
      clientAccess: this.host.clientAccess,
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
      codexPath: () => this.host.settings.codexPath(),
      vaultPath: this.host.vaultPath,
      threadNamingModel: () => this.host.settings.threadNamingModel(),
      threadNamingEffort: () => this.host.settings.threadNamingEffort(),
      clientAccess: this.host.clientAccess,
    });
  }

  open(): void {
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
    this.refreshLifecycle = transitionThreadsViewRefreshLifecycle(this.refreshLifecycle, { type: "invalidated" });
    this.deferredTasks.clearAll();
    this.unsubscribeThreads?.();
    this.unsubscribeThreads = null;
    unmountThreadsViewShell(this.environment.root);
  }

  async refresh(): Promise<void> {
    const refresh = this.startRefresh();
    if (!this.currentThreadsSnapshot()) {
      this.status = { kind: "loading", message: "Loading threads..." };
    }
    this.render();
    try {
      const threads = await this.host.threadCatalog.refreshActive();
      if (this.isStaleRefresh(refresh)) return;
      this.threads = threads;
      this.threadsLoaded = true;
      this.status = threads.length === 0 ? { kind: "empty", message: "No threads" } : { kind: "idle" };
    } catch (error) {
      if (isStaleAppServerSharedQueryContextError(error)) return;
      if (!this.currentThreadsSnapshot()) {
        this.status = { kind: "error", message: error instanceof Error ? error.message : String(error) };
      }
    } finally {
      this.finishRefresh(refresh);
    }
  }

  refreshLiveState(): void {
    this.scheduleRender();
  }

  private receiveObservedThreads(threads: readonly Thread[]): void {
    this.threads = threads;
    this.threadsLoaded = true;
    this.status = threads.length === 0 ? { kind: "empty", message: "No threads" } : { kind: "idle" };
    this.render();
  }

  private receiveObservedThreadsResult(result: ObservedResult<readonly Thread[]>): void {
    const observedThreads = observedValue(result);
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

  private startRefresh(): ActiveThreadsViewRefresh {
    const refresh: ActiveThreadsViewRefresh = { kind: "loading" };
    this.refreshLifecycle = transitionThreadsViewRefreshLifecycle(this.refreshLifecycle, { type: "started", refresh });
    return refresh;
  }

  private finishRefresh(refresh: ActiveThreadsViewRefresh): void {
    if (this.isStaleRefresh(refresh)) return;
    this.refreshLifecycle = transitionThreadsViewRefreshLifecycle(this.refreshLifecycle, { type: "finished", refresh });
    this.render();
  }

  private isStaleRefresh(refresh: ActiveThreadsViewRefresh): boolean {
    return this.refreshLifecycle !== refresh;
  }

  private render(): void {
    renderThreadsViewShell(
      this.environment.root,
      {
        status: this.status.kind === "idle" ? null : this.status.message,
        loading: this.refreshLifecycle.kind === "loading",
        rows: threadRows(
          this.threads,
          this.host.getOpenPanelSnapshots(),
          this.renameStates,
          this.archiveConfirmThreadId,
          this.host.settings.archiveExportEnabled(),
        ),
      },
      {
        refresh: () => void this.refresh(),
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
    this.deferredTasks.scheduleRender(() => {
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
    const editingState = this.renameStates.get(threadId);
    if (!editingState || editingState.kind === "generating") return;
    try {
      if (this.renameStates.get(threadId) !== editingState) return;
      const result = await this.operations.renameThread(threadId, value);
      if (this.renameStates.get(threadId) !== editingState) return;
      if (!result) {
        this.cancelRename(threadId);
        return;
      }
      this.renameStates.delete(threadId);
      this.render();
    } catch (error) {
      this.status = { kind: "error", message: error instanceof Error ? error.message : String(error) };
      this.render();
    }
  }

  private async autoNameThread(threadId: string): Promise<void> {
    const previousState = this.renameStates.get(threadId);
    const generatingState = this.transitionRenameState(threadId, {
      type: "auto-name-started",
      generationToken: this.nextRenameGenerationToken,
    });
    if (generatingState === previousState || generatingState?.kind !== "generating") return;
    this.nextRenameGenerationToken += 1;
    this.render();

    try {
      if (this.renameStates.get(threadId) !== generatingState) return;
      const title = await this.titleService.generateTitle(threadId);
      this.transitionRenameState(threadId, { type: "auto-name-generated", generatingState, title });
    } catch (error) {
      if (this.renameStates.get(threadId) === generatingState) {
        this.status = { kind: "error", message: error instanceof Error ? error.message : String(error) };
      }
    } finally {
      this.finishAutoNameThread(threadId, generatingState);
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
    try {
      const result = await this.operations.archiveThread(threadId, {
        saveMarkdown,
        closeOpenPanels: true,
      });
      if (!result) return;
      if (this.archiveConfirmThreadId === threadId) this.archiveConfirmThreadId = null;
      this.renameStates.delete(threadId);
    } catch (error) {
      this.status = { kind: "error", message: error instanceof Error ? error.message : String(error) };
      this.render();
    }
  }

  private finishAutoNameThread(threadId: string, generatingState: ThreadsGeneratingRenameState): void {
    const previousState = this.renameStates.get(threadId);
    const nextState = this.transitionRenameState(threadId, { type: "auto-name-finished", generatingState });
    if (nextState !== previousState) this.render();
  }

  private transitionRenameState(threadId: string, event: ThreadsRenameLifecycleEvent): ThreadsRenameState | undefined {
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
