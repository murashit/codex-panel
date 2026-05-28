import { ItemView, Notice, type WorkspaceLeaf } from "obsidian";

import type { AppServerClient } from "../../app-server/client";
import { ConnectionManager, StaleConnectionError } from "../../app-server/connection-manager";
import { VIEW_TYPE_CODEX_THREADS } from "../../constants";
import type { Thread } from "../../generated/app-server/v2/Thread";
import type { CodexPanelSettings } from "../../settings/model";
import { exportArchivedThreadMarkdown } from "../../domain/threads/export";
import type { OpenCodexPanelSnapshot } from "../../runtime/open-panel-snapshot";
import { findThreadNamingContext, THREAD_NAMING_CONTEXT_UNAVAILABLE_MESSAGE } from "../../domain/threads/naming";
import { generateThreadTitleWithCodex } from "../../app-server/thread-naming";
import { renderThreadsView, unmountThreadsView } from "./renderer";
import { threadRows, type ThreadsRenameState } from "./state";
import { ThreadsViewDeferredTasks } from "./view-lifecycle";

export interface CodexThreadsHost {
  readonly settings: CodexPanelSettings;
  readonly vaultPath: string;
  openNewPanel(): Promise<unknown>;
  openThreadInAvailableView(threadId: string): Promise<void>;
  getOpenPanelSnapshots(): OpenCodexPanelSnapshot[];
  notifyThreadArchived(threadId: string): void;
  notifyThreadRenamed(threadId: string, name: string | null): void;
  refreshThreadList(fetchThreads: () => Promise<readonly Thread[]>): Promise<readonly Thread[]>;
  cachedThreadList(): readonly Thread[] | null;
}

type ThreadsViewRefreshLifecycleState = { kind: "idle" } | { kind: "loading" };
type ActiveThreadsViewRefresh = Extract<ThreadsViewRefreshLifecycleState, { kind: "loading" }>;
type ThreadsViewConnectionLifecycleState = { kind: "idle" } | { kind: "connecting"; promise: Promise<void> | null };
type ActiveThreadsViewConnection = Extract<ThreadsViewConnectionLifecycleState, { kind: "connecting" }>;
type ThreadsViewStatus =
  | { kind: "idle" }
  | { kind: "loading"; message: string }
  | { kind: "empty"; message: string }
  | { kind: "log"; message: string }
  | { kind: "error"; message: string };

export class CodexThreadsView extends ItemView {
  private readonly connection: ConnectionManager;
  private readonly deferredTasks: ThreadsViewDeferredTasks;
  private client: AppServerClient | null = null;
  private connectionLifecycle: ThreadsViewConnectionLifecycleState = { kind: "idle" };
  private refreshLifecycle: ThreadsViewRefreshLifecycleState = { kind: "idle" };
  private status: ThreadsViewStatus = { kind: "idle" };
  private threads: readonly Thread[] = [];
  private readonly renameStates = new Map<string, ThreadsRenameState>();
  private archiveConfirmThreadId: string | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: CodexThreadsHost,
  ) {
    super(leaf);
    this.deferredTasks = new ThreadsViewDeferredTasks(() => this.containerEl.win);
    this.connection = new ConnectionManager(() => this.plugin.settings.codexPath, this.plugin.vaultPath, {
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
        this.refreshLifecycle = { kind: "idle" };
        this.status = { kind: "error", message: "Codex app-server stopped." };
        this.render();
      },
    });
  }

  override getViewType(): string {
    return VIEW_TYPE_CODEX_THREADS;
  }

  override getDisplayText(): string {
    return "Codex threads";
  }

  override getIcon(): string {
    return "list-checks";
  }

  override async onOpen(): Promise<void> {
    this.registerDomEvent(this.containerEl.doc, "pointerdown", (event) => {
      this.cancelArchiveConfirmOnOutsidePointer(event);
    });
    const cachedThreads = this.plugin.cachedThreadList();
    if (cachedThreads) {
      this.threads = cachedThreads;
    }
    this.render();
    void this.refresh();
  }

  override async onClose(): Promise<void> {
    this.invalidateConnectionWork();
    this.refreshLifecycle = { kind: "idle" };
    this.deferredTasks.clearAll();
    this.connection.disconnect();
    this.client = null;
    unmountThreadsView(this.containerEl);
  }

  async refresh(): Promise<void> {
    const refresh = this.startRefresh();
    this.status = this.threads.length === 0 ? { kind: "loading", message: "Loading threads..." } : { kind: "idle" };
    this.render();
    try {
      await this.ensureConnected();
      if (this.isStaleRefresh(refresh) || !this.client) return;
      const threads = await this.plugin.refreshThreadList(async () => {
        if (!this.client) return [];
        const response = await this.client.listThreads(this.plugin.vaultPath);
        return response.data;
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

  private startRefresh(): ActiveThreadsViewRefresh {
    const refresh: ActiveThreadsViewRefresh = { kind: "loading" };
    this.refreshLifecycle = refresh;
    return refresh;
  }

  private finishRefresh(refresh: ActiveThreadsViewRefresh): void {
    if (this.isStaleRefresh(refresh)) return;
    this.refreshLifecycle = { kind: "idle" };
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
      .connect()
      .then(() => {
        if (this.isStaleConnectionWork(connection)) throw new StaleConnectionError();
        this.client = this.connection.currentClient();
      })
      .finally(() => {
        if (this.connectionLifecycle === connection && connection.promise === promise) {
          this.connectionLifecycle = { kind: "idle" };
        }
      });
    connection.promise = promise;
    return promise;
  }

  private beginConnectionWork(): ActiveThreadsViewConnection {
    const connection: ActiveThreadsViewConnection = { kind: "connecting", promise: null };
    this.connectionLifecycle = connection;
    return connection;
  }

  private invalidateConnectionWork(): void {
    this.connectionLifecycle = { kind: "idle" };
  }

  private activeConnection(): ActiveThreadsViewConnection | null {
    return this.connectionLifecycle.kind === "connecting" ? this.connectionLifecycle : null;
  }

  private isStaleConnectionWork(connection: ActiveThreadsViewConnection): boolean {
    return this.connectionLifecycle !== connection;
  }

  private render(): void {
    renderThreadsView(
      this.containerEl,
      {
        status: threadsViewStatusText(this.status),
        loading: this.refreshLifecycle.kind === "loading",
        rows: threadRows(
          this.threads,
          this.plugin.getOpenPanelSnapshots(),
          this.renameStates,
          this.archiveConfirmThreadId,
          this.plugin.settings.archiveExportEnabled,
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

  refreshLiveState(): void {
    this.scheduleRender();
  }

  applyThreadListSnapshot(threads: readonly Thread[]): void {
    this.threads = threads;
    this.status = threads.length === 0 ? { kind: "empty", message: "No threads" } : { kind: "idle" };
    this.render();
  }

  private scheduleRefresh(): void {
    this.deferredTasks.scheduleRefresh(() => {
      void this.refresh();
    });
  }

  private async openThread(threadId: string): Promise<void> {
    this.archiveConfirmThreadId = null;
    await this.plugin.openThreadInAvailableView(threadId);
  }

  private async openNewPanel(): Promise<void> {
    await this.plugin.openNewPanel();
  }

  private startRename(threadId: string, value: string): void {
    this.archiveConfirmThreadId = null;
    this.renameStates.set(threadId, { kind: "editing", draft: value });
    this.render();
  }

  private updateRename(threadId: string, value: string): void {
    const current = this.renameStates.get(threadId);
    this.renameStates.set(threadId, current?.kind === "generating" ? { ...current, draft: value } : { kind: "editing", draft: value });
    this.render();
  }

  private cancelRename(threadId: string): void {
    this.renameStates.delete(threadId);
    this.render();
  }

  private async saveRename(threadId: string, value: string): Promise<void> {
    const editingState = this.renameStates.get(threadId);
    if (!editingState || editingState.kind === "generating") return;
    const name = value.trim();
    if (!name) {
      this.cancelRename(threadId);
      return;
    }
    try {
      await this.ensureConnected();
      if (this.renameStates.get(threadId) !== editingState) return;
      if (!this.client) return;
      await this.client.setThreadName(threadId, name);
      this.renameStates.delete(threadId);
      this.plugin.notifyThreadRenamed(threadId, name);
    } catch (error) {
      this.status = { kind: "error", message: error instanceof Error ? error.message : String(error) };
      this.render();
    }
  }

  private async autoNameThread(threadId: string): Promise<void> {
    const editingState = this.renameStates.get(threadId);
    if (!editingState || editingState.kind === "generating") return;

    const generatingState: ThreadsRenameState = {
      kind: "generating",
      draft: editingState.draft,
      originalDraft: editingState.draft,
    };
    this.renameStates.set(threadId, generatingState);
    this.render();

    try {
      await this.ensureConnected();
      if (this.renameStates.get(threadId) !== generatingState) return;
      if (!this.client) return;
      const client = this.client;
      const context = await findThreadNamingContext({
        threadId,
        readTurns: (id, cursor, limit, sortDirection) => client.threadTurnsList(id, cursor, limit, sortDirection),
      });
      if (!context) throw new Error(THREAD_NAMING_CONTEXT_UNAVAILABLE_MESSAGE);
      const title = await generateThreadTitleWithCodex(this.plugin.settings.codexPath, this.plugin.vaultPath, context, {
        threadNamingModel: this.plugin.settings.threadNamingModel,
        threadNamingEffort: this.plugin.settings.threadNamingEffort,
      });
      if (!title) throw new Error("Codex did not return a usable thread title.");
      const current = this.renameStates.get(threadId);
      if (current !== generatingState) return;
      if (current.draft !== generatingState.originalDraft) return;
      this.renameStates.set(threadId, { ...generatingState, draft: title });
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
    const viewWindow = this.containerEl.doc.defaultView;
    if (viewWindow && target instanceof viewWindow.Element) {
      const archiveConfirm = target.closest(".codex-panel-threads__archive-confirm");
      if (archiveConfirm && this.containerEl.contains(archiveConfirm)) return;
    }
    this.archiveConfirmThreadId = null;
    this.render();
  }

  private async archiveThread(threadId: string, saveMarkdown: boolean): Promise<void> {
    try {
      await this.ensureConnected();
      if (!this.client) return;
      if (saveMarkdown) {
        const response = await this.client.readThread(threadId, true);
        const result = await exportArchivedThreadMarkdown(
          response.thread,
          { ...this.plugin.settings, vaultPath: this.plugin.vaultPath },
          this.app.vault.adapter,
        );
        new Notice(`Saved archived thread to ${result.path}.`);
      }
      await this.client.archiveThread(threadId);
      if (this.archiveConfirmThreadId === threadId) this.archiveConfirmThreadId = null;
      this.renameStates.delete(threadId);
      this.plugin.notifyThreadArchived(threadId);
    } catch (error) {
      this.status = { kind: "error", message: error instanceof Error ? error.message : String(error) };
      this.render();
    }
  }

  private finishAutoNameThread(threadId: string, generatingState: ThreadsRenameState): void {
    const current = this.renameStates.get(threadId);
    if (current?.kind !== "generating") return;
    const draft = current === generatingState ? generatingState.draft : current.draft;
    this.renameStates.set(threadId, { kind: "editing", draft });
    this.render();
  }
}

function threadsViewStatusText(status: ThreadsViewStatus): string | null {
  return status.kind === "idle" ? null : status.message;
}
