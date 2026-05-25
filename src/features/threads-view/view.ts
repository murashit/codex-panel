import { ItemView, Notice, type WorkspaceLeaf } from "obsidian";

import type { AppServerClient } from "../../app-server/client";
import { ConnectionManager, StaleConnectionError } from "../../app-server/connection-manager";
import { VIEW_TYPE_CODEX_THREADS } from "../../constants";
import type { Thread } from "../../generated/app-server/v2/Thread";
import type { CodexPanelSettings } from "../../settings/model";
import { exportArchivedThreadMarkdown } from "../../domain/threads/export";
import type { OpenCodexPanelSnapshot } from "../chat/panel-snapshot";
import { renderThreadsView } from "./renderer";
import { threadRows } from "./state";

export interface CodexThreadsHost {
  readonly settings: CodexPanelSettings;
  readonly vaultPath: string;
  openNewPanel(): Promise<unknown>;
  openThreadInAvailableView(threadId: string): Promise<void>;
  getOpenPanelSnapshots(): OpenCodexPanelSnapshot[];
  notifyThreadArchived(threadId: string): void;
  notifyThreadRenamed(threadId: string, name: string): void;
}

export class CodexThreadsView extends ItemView {
  private readonly connection: ConnectionManager;
  private client: AppServerClient | null = null;
  private connectingPromise: Promise<void> | null = null;
  private connectionGeneration = 0;
  private refreshGeneration = 0;
  private renderTimer: number | null = null;
  private refreshTimer: number | null = null;
  private status: string | null = null;
  private loading = false;
  private threads: Thread[] = [];
  private readonly renameDrafts = new Map<string, string>();

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: CodexThreadsHost,
  ) {
    super(leaf);
    this.connection = new ConnectionManager(() => this.plugin.settings.codexPath, this.plugin.vaultPath, {
      onNotification: () => {
        this.scheduleRefresh();
      },
      onServerRequest: (request) => {
        this.connection.currentClient()?.rejectServerRequest(request.id, -32601, "Codex Threads view does not handle server requests.");
      },
      onLog: (message) => {
        this.status = message;
        this.render();
      },
      onExit: () => {
        this.client = null;
        this.connectingPromise = null;
        this.status = "Codex app-server stopped.";
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
    this.render();
    void this.refresh();
  }

  override async onClose(): Promise<void> {
    this.connectionGeneration += 1;
    this.refreshGeneration += 1;
    this.connectingPromise = null;
    if (this.renderTimer !== null) {
      this.containerEl.win.clearTimeout(this.renderTimer);
      this.renderTimer = null;
    }
    if (this.refreshTimer !== null) {
      this.containerEl.win.clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.connection.disconnect();
    this.client = null;
  }

  async refresh(): Promise<void> {
    const connectionGeneration = this.connectionGeneration;
    const refreshGeneration = ++this.refreshGeneration;
    this.loading = true;
    this.status = this.threads.length === 0 ? "Loading threads..." : null;
    this.render();
    try {
      await this.ensureConnected();
      if (this.isStaleRefresh(connectionGeneration, refreshGeneration) || !this.client) return;
      const response = await this.client.listThreads(this.plugin.vaultPath);
      if (this.isStaleRefresh(connectionGeneration, refreshGeneration)) return;
      this.threads = response.data;
      this.status = response.data.length === 0 ? "No threads" : null;
    } catch (error) {
      if (error instanceof StaleConnectionError) return;
      this.status = error instanceof Error ? error.message : String(error);
    } finally {
      if (!this.isStaleRefresh(connectionGeneration, refreshGeneration)) {
        this.loading = false;
        this.render();
      }
    }
  }

  private isStaleRefresh(connectionGeneration: number, refreshGeneration: number): boolean {
    return connectionGeneration !== this.connectionGeneration || refreshGeneration !== this.refreshGeneration;
  }

  private async ensureConnected(): Promise<void> {
    if (this.connection.isConnected()) {
      this.client = this.connection.currentClient();
      return;
    }
    if (this.connectingPromise) return this.connectingPromise;

    const generation = this.connectionGeneration;
    const promise = this.connection
      .connect()
      .then(() => {
        if (generation !== this.connectionGeneration) throw new StaleConnectionError();
        this.client = this.connection.currentClient();
      })
      .finally(() => {
        if (generation === this.connectionGeneration) this.connectingPromise = null;
      });
    this.connectingPromise = promise;
    return promise;
  }

  private render(): void {
    renderThreadsView(
      this.containerEl,
      {
        status: this.status,
        loading: this.loading,
        rows: threadRows(this.threads, this.plugin.getOpenPanelSnapshots(), this.renameDrafts),
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
        archiveThread: (threadId) => void this.archiveThread(threadId),
      },
    );
  }

  private scheduleRender(): void {
    if (this.renderTimer !== null) return;
    this.renderTimer = this.containerEl.win.setTimeout(() => {
      this.renderTimer = null;
      this.render();
    }, 0);
  }

  refreshLiveState(): void {
    this.scheduleRender();
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer !== null) return;
    this.refreshTimer = this.containerEl.win.setTimeout(() => {
      this.refreshTimer = null;
      void this.refresh();
    }, 250);
  }

  private async openThread(threadId: string): Promise<void> {
    await this.plugin.openThreadInAvailableView(threadId);
  }

  private async openNewPanel(): Promise<void> {
    await this.plugin.openNewPanel();
  }

  private startRename(threadId: string, value: string): void {
    this.renameDrafts.set(threadId, value);
    this.render();
  }

  private updateRename(threadId: string, value: string): void {
    this.renameDrafts.set(threadId, value);
  }

  private cancelRename(threadId: string): void {
    this.renameDrafts.delete(threadId);
    this.render();
  }

  private async saveRename(threadId: string, value: string): Promise<void> {
    const name = value.trim();
    if (!name) {
      this.cancelRename(threadId);
      return;
    }
    try {
      await this.ensureConnected();
      if (!this.client) return;
      await this.client.setThreadName(threadId, name);
      this.renameDrafts.delete(threadId);
      this.plugin.notifyThreadRenamed(threadId, name);
    } catch (error) {
      this.status = error instanceof Error ? error.message : String(error);
      this.render();
    }
  }

  private async archiveThread(threadId: string): Promise<void> {
    try {
      await this.ensureConnected();
      if (!this.client) return;
      if (this.plugin.settings.archiveExportEnabled) {
        const response = await this.client.readThread(threadId, true);
        const result = await exportArchivedThreadMarkdown(response.thread, this.plugin.settings, this.app.vault.adapter);
        new Notice(`Saved archived thread to ${result.path}.`);
      }
      await this.client.archiveThread(threadId);
      this.renameDrafts.delete(threadId);
      this.plugin.notifyThreadArchived(threadId);
    } catch (error) {
      this.status = error instanceof Error ? error.message : String(error);
      this.render();
    }
  }
}
