import { Notice } from "obsidian";

import type { AppServerClientAccess } from "../../app-server/connection/client-access";
import type { AppServerObservedQueryResult } from "../../app-server/query/cache";
import { isStaleAppServerSharedQueryContextError } from "../../app-server/query/shared-queries";
import type { ReasoningEffort } from "../../domain/catalog/metadata";
import type { Thread } from "../../domain/threads/model";
import type { OpenCodexPanelSnapshot } from "../../workspace/panel-coordinator";
import type { ActiveThreadCatalogReader, ActiveThreadCatalogThreadEvents } from "../../workspace/active-thread-catalog";
import type { ArchiveExportAdapter, ArchiveExportSettings } from "../../domain/threads/archive-markdown";
import { createThreadOperations, type ThreadOperations } from "../threads/thread-operations";
import { createThreadTitleService, type ThreadTitleService } from "../threads/thread-title-service";
import { renderThreadsView, unmountThreadsView } from "./renderer";
import {
  completedThreadAutoNameState,
  editingThreadRenameState,
  generatedThreadAutoNameState,
  startedThreadAutoNameState,
  threadRows,
  updatedThreadRenameState,
  type ThreadsGeneratingRenameState,
  type ThreadsRenameState,
} from "./state";
import {
  createThreadsViewDeferredTasks,
  transitionThreadsViewRefreshLifecycle,
  type ActiveThreadsViewRefresh,
  type ThreadsViewDeferredTasks,
  type ThreadsViewRefreshLifecycleState,
} from "./view-lifecycle";

export interface CodexThreadsHost {
  readonly settings: CodexThreadsSettings;
  readonly vaultPath: string;
  readonly clientAccess: AppServerClientAccess;
  readonly threadCatalog: ThreadsThreadCatalog;
  openNewPanel(): Promise<unknown>;
  openThreadInAvailableView(threadId: string): Promise<void>;
  getOpenPanelSnapshots(): OpenCodexPanelSnapshot[];
}

type ThreadsThreadCatalog = ActiveThreadCatalogReader & ActiveThreadCatalogThreadEvents;

interface CodexThreadsSettings extends ArchiveExportSettings {
  codexPath: string;
  threadNamingModel: string | null;
  threadNamingEffort: ReasoningEffort | null;
  archiveExportEnabled: boolean;
}

export interface CodexThreadsSessionEnvironment {
  root: HTMLElement;
  host: CodexThreadsHost;
  registerPointerDown(handler: (event: PointerEvent) => void): void;
  archiveAdapter(): ArchiveExportAdapter;
  viewWindow(): Window | null;
}

type ThreadsViewStatus =
  | { kind: "idle" }
  | { kind: "loading"; message: string }
  | { kind: "empty"; message: string }
  | { kind: "log"; message: string }
  | { kind: "error"; message: string };

export class CodexThreadsSession {
  private readonly operations: ThreadOperations;
  private readonly titleService: ThreadTitleService;
  private readonly deferredTasks: ThreadsViewDeferredTasks;
  private refreshLifecycle: ThreadsViewRefreshLifecycleState = { kind: "idle" };
  private status: ThreadsViewStatus = { kind: "idle" };
  private threads: readonly Thread[] = [];
  private readonly renameStates = new Map<string, ThreadsRenameState>();
  private unsubscribeThreads: (() => void) | null = null;
  private archiveConfirmThreadId: string | null = null;

  constructor(private readonly environment: CodexThreadsSessionEnvironment) {
    this.deferredTasks = createThreadsViewDeferredTasks(() => this.viewWindow());
    this.operations = createThreadOperations({
      clientAccess: this.host.clientAccess,
      archiveExport: {
        settings: () => this.host.settings,
        enabled: () => this.host.settings.archiveExportEnabled,
        vaultPath: this.host.vaultPath,
      },
      archiveAdapter: () => this.environment.archiveAdapter(),
      catalog: this.host.threadCatalog,
      notice: (message) => {
        new Notice(message);
      },
    });
    this.titleService = createThreadTitleService({
      codexPath: () => this.host.settings.codexPath,
      vaultPath: this.host.vaultPath,
      threadNamingModel: () => this.host.settings.threadNamingModel,
      threadNamingEffort: () => this.host.settings.threadNamingEffort,
      clientAccess: this.host.clientAccess,
    });
  }

  open(): void {
    this.environment.registerPointerDown((event) => {
      this.cancelArchiveConfirmOnOutsidePointer(event);
    });
    const activeThreadsSnapshot = this.host.threadCatalog.snapshot();
    if (activeThreadsSnapshot) {
      this.threads = activeThreadsSnapshot;
    }
    this.unsubscribeThreads = this.host.threadCatalog.observe((result) => {
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
    unmountThreadsView(this.environment.root);
  }

  async refresh(): Promise<void> {
    const refresh = this.startRefresh();
    this.status = this.threads.length === 0 ? { kind: "loading", message: "Loading threads..." } : { kind: "idle" };
    this.render();
    try {
      const threads = await this.host.threadCatalog.refresh();
      if (this.isStaleRefresh(refresh)) return;
      this.threads = threads;
      this.status = threads.length === 0 ? { kind: "empty", message: "No threads" } : { kind: "idle" };
    } catch (error) {
      if (isStaleAppServerSharedQueryContextError(error)) return;
      this.status = { kind: "error", message: error instanceof Error ? error.message : String(error) };
    } finally {
      this.finishRefresh(refresh);
    }
  }

  refreshLiveState(): void {
    this.scheduleRender();
  }

  private receiveObservedThreads(threads: readonly Thread[]): void {
    this.threads = threads;
    this.status = threads.length === 0 ? { kind: "empty", message: "No threads" } : { kind: "idle" };
    this.render();
  }

  private receiveObservedThreadsResult(result: AppServerObservedQueryResult<readonly Thread[]>): void {
    if (result.data) {
      this.receiveObservedThreads(result.data);
      return;
    }
    if (result.isFetching && this.threads.length === 0) {
      this.status = { kind: "loading", message: "Loading threads..." };
      this.render();
      return;
    }
    if (result.error && this.threads.length === 0) {
      this.status = { kind: "error", message: result.error.message };
      this.render();
    }
  }

  private get host(): CodexThreadsHost {
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
    renderThreadsView(
      this.environment.root,
      {
        status: threadsViewStatusText(this.status),
        loading: this.refreshLifecycle.kind === "loading",
        rows: threadRows(
          this.threads,
          this.host.getOpenPanelSnapshots(),
          this.renameStates,
          this.archiveConfirmThreadId,
          this.host.settings.archiveExportEnabled,
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
    this.renameStates.set(threadId, editingThreadRenameState(value));
    this.render();
  }

  private updateRename(threadId: string, value: string): void {
    this.renameStates.set(threadId, updatedThreadRenameState(this.renameStates.get(threadId), value));
    this.render();
  }

  private cancelRename(threadId: string): void {
    this.renameStates.delete(threadId);
    this.render();
  }

  private async saveRename(threadId: string, value: string): Promise<void> {
    const editingState = this.renameStates.get(threadId);
    if (!editingState || editingState.kind === "generating") return;
    try {
      if (this.renameStates.get(threadId) !== editingState) return;
      const result = await this.operations.renameThread(threadId, value);
      if (!result) {
        this.cancelRename(threadId);
        return;
      }
      this.renameStates.delete(threadId);
    } catch (error) {
      this.status = { kind: "error", message: error instanceof Error ? error.message : String(error) };
      this.render();
    }
  }

  private async autoNameThread(threadId: string): Promise<void> {
    const generatingState = startedThreadAutoNameState(this.renameStates.get(threadId));
    if (!generatingState) return;
    this.renameStates.set(threadId, generatingState);
    this.render();

    try {
      if (this.renameStates.get(threadId) !== generatingState) return;
      const title = await this.titleService.generateTitle(threadId);
      const renamedState = generatedThreadAutoNameState(this.renameStates.get(threadId), generatingState, title);
      if (renamedState) this.renameStates.set(threadId, renamedState);
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
    const target = event.target;
    const viewWindow = this.viewWindow() as Window & { Element: typeof Element };
    if (target instanceof viewWindow.Element) {
      const archiveConfirm = target.closest(".codex-panel-threads__archive-confirm");
      if (archiveConfirm && this.environment.root.contains(archiveConfirm)) return;
    }
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
    const nextState = completedThreadAutoNameState(this.renameStates.get(threadId), generatingState);
    if (!nextState) return;
    this.renameStates.set(threadId, nextState);
    this.render();
  }

  private viewWindow(): Window {
    return this.environment.viewWindow() ?? window;
  }
}

function threadsViewStatusText(status: ThreadsViewStatus): string | null {
  return status.kind === "idle" ? null : status.message;
}
