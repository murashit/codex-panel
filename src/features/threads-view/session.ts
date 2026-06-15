import { Notice } from "obsidian";

import type { AppServerClient } from "../../app-server/connection/client";
import { ConnectionManager, type ConnectionManagerHandlers, StaleConnectionError } from "../../app-server/connection/connection-manager";
import { listThreads } from "../../app-server/services/threads";
import type { Thread } from "../../domain/threads/model";
import type { CodexPanelSettings } from "../../settings/model";
import type { OpenCodexPanelSnapshot } from "../../workspace/open-panel-snapshot";
import type { ArchiveExportAdapter } from "../../app-server/services/thread-archive-markdown";
import { ThreadOperations } from "../threads/thread-operations";
import { ThreadTitleService } from "../threads/thread-title-service";
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
  transitionThreadsViewConnectionLifecycle,
  transitionThreadsViewRefreshLifecycle,
  type ActiveThreadsViewConnection,
  type ActiveThreadsViewRefresh,
  type ThreadsViewDeferredTasks,
  type ThreadsViewConnectionLifecycleState,
  type ThreadsViewRefreshLifecycleState,
} from "./view-lifecycle";

export interface CodexThreadsHost {
  readonly settings: CodexPanelSettings;
  readonly vaultPath: string;
  readonly threadCatalog: {
    archiveThreadInCatalog(threadId: string, options?: { closeOpenPanels?: boolean }): void;
    renameThreadInCatalog(threadId: string, name: string | null): void;
    refreshFromOpenSurface(): void;
    refreshThreads(fetchThreads: () => Promise<readonly Thread[]>): Promise<readonly Thread[]>;
    cachedThreads(): readonly Thread[] | null;
  };
  openNewPanel(): Promise<unknown>;
  openThreadInAvailableView(threadId: string): Promise<void>;
  getOpenPanelSnapshots(): OpenCodexPanelSnapshot[];
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
  private readonly connection: ConnectionManager;
  private readonly operations: ThreadOperations;
  private readonly titleService: ThreadTitleService;
  private readonly deferredTasks: ThreadsViewDeferredTasks;
  private client: AppServerClient | null = null;
  private connectionLifecycle: ThreadsViewConnectionLifecycleState = { kind: "idle" };
  private refreshLifecycle: ThreadsViewRefreshLifecycleState = { kind: "idle" };
  private status: ThreadsViewStatus = { kind: "idle" };
  private threads: readonly Thread[] = [];
  private readonly renameStates = new Map<string, ThreadsRenameState>();
  private archiveConfirmThreadId: string | null = null;

  constructor(private readonly environment: CodexThreadsSessionEnvironment) {
    this.deferredTasks = createThreadsViewDeferredTasks(() => this.viewWindow());
    this.connection = new ConnectionManager(() => this.host.settings.codexPath, this.host.vaultPath);
    this.operations = new ThreadOperations({
      connection: {
        ensureConnected: () => this.ensureConnected(),
        currentClient: () => this.client,
      },
      settings: {
        current: () => this.host.settings,
        vaultPath: this.host.vaultPath,
      },
      archiveAdapter: () => this.environment.archiveAdapter(),
      catalog: {
        archiveThreadInCatalog: (threadId, options) => {
          this.host.threadCatalog.archiveThreadInCatalog(threadId, options);
        },
        renameThreadInCatalog: (threadId, name) => {
          this.host.threadCatalog.renameThreadInCatalog(threadId, name);
        },
      },
      notice: (message) => {
        new Notice(message);
      },
    });
    this.titleService = new ThreadTitleService({
      settings: {
        current: () => this.host.settings,
        vaultPath: this.host.vaultPath,
      },
      currentClient: () => this.client,
    });
  }

  private connectionHandlers(): ConnectionManagerHandlers {
    return {
      onNotification: () => {
        this.scheduleRefresh();
      },
      onServerRequest: (request) => {
        this.connection.currentClient()?.rejectServerRequest(request.id, -32601, "Codex Threads view does not handle server requests.");
      },
      onLog: (message) => {
        this.status = { kind: "log", message };
        this.render();
      },
      onExit: () => {
        this.client = null;
        this.invalidateConnectionWork();
        this.refreshLifecycle = transitionThreadsViewRefreshLifecycle(this.refreshLifecycle, { type: "invalidated" });
        this.status = { kind: "error", message: "Codex app-server stopped." };
        this.render();
      },
    };
  }

  open(): void {
    this.environment.registerPointerDown((event) => {
      this.cancelArchiveConfirmOnOutsidePointer(event);
    });
    const cachedThreads = this.host.threadCatalog.cachedThreads();
    if (cachedThreads) {
      this.threads = cachedThreads;
    }
    this.render();
    void this.refresh();
  }

  close(): void {
    this.invalidateConnectionWork();
    this.refreshLifecycle = transitionThreadsViewRefreshLifecycle(this.refreshLifecycle, { type: "invalidated" });
    this.deferredTasks.clearAll();
    this.connection.disconnect();
    this.client = null;
    unmountThreadsView(this.environment.root);
  }

  async refresh(): Promise<void> {
    const refresh = this.startRefresh();
    this.status = this.threads.length === 0 ? { kind: "loading", message: "Loading threads..." } : { kind: "idle" };
    this.render();
    try {
      await this.ensureConnected();
      if (this.isStaleRefresh(refresh) || !this.client) return;
      const threads = await this.host.threadCatalog.refreshThreads(async () => {
        if (!this.client) return [];
        return listThreads(this.client, this.host.vaultPath);
      });
      if (this.isStaleRefresh(refresh)) return;
      this.threads = threads;
      this.status = threads.length === 0 ? { kind: "empty", message: "No threads" } : { kind: "idle" };
    } catch (error) {
      if (error instanceof StaleConnectionError) return;
      this.status = { kind: "error", message: error instanceof Error ? error.message : String(error) };
    } finally {
      this.finishRefresh(refresh);
    }
  }

  refreshLiveState(): void {
    this.scheduleRender();
  }

  applyThreadListSnapshot(threads: readonly Thread[]): void {
    this.threads = threads;
    this.status = threads.length === 0 ? { kind: "empty", message: "No threads" } : { kind: "idle" };
    this.render();
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

  private async ensureConnected(): Promise<void> {
    const connecting = this.activeConnection();
    if (connecting?.promise) return connecting.promise;

    if (this.connection.isConnected()) {
      this.client = this.connection.currentClient();
      return;
    }

    const connection = this.beginConnectionWork();
    const promise = this.connection
      .connect(this.connectionHandlers())
      .then(() => {
        if (this.isStaleConnectionWork(connection)) throw new StaleConnectionError();
        this.client = this.connection.currentClient();
      })
      .finally(() => {
        this.connectionLifecycle = transitionThreadsViewConnectionLifecycle(this.connectionLifecycle, {
          type: "finished",
          connection,
          promise,
        });
      });
    connection.promise = promise;
    return promise;
  }

  private beginConnectionWork(): ActiveThreadsViewConnection {
    const connection: ActiveThreadsViewConnection = { kind: "connecting", promise: null };
    this.connectionLifecycle = transitionThreadsViewConnectionLifecycle(this.connectionLifecycle, { type: "started", connection });
    return connection;
  }

  private invalidateConnectionWork(): void {
    this.connectionLifecycle = transitionThreadsViewConnectionLifecycle(this.connectionLifecycle, { type: "invalidated" });
  }

  private activeConnection(): ActiveThreadsViewConnection | null {
    return this.connectionLifecycle.kind === "connecting" ? this.connectionLifecycle : null;
  }

  private isStaleConnectionWork(connection: ActiveThreadsViewConnection): boolean {
    return this.connectionLifecycle !== connection;
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

  private scheduleRefresh(): void {
    this.deferredTasks.scheduleRefresh(() => {
      void this.refresh();
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
      await this.ensureConnected();
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
      await this.ensureConnected();
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
      await this.ensureConnected();
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
