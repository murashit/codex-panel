import type { App } from "obsidian";
import type { AppServerClient } from "./app-server/connection/client";
import type { AppServerClientAccess, AppServerClientAccessOptions } from "./app-server/connection/client-access";
import { withShortLivedAppServerClient } from "./app-server/connection/short-lived-client";
import { AppServerQueryCache } from "./app-server/query/cache";
import { type AppServerQueryContext, appServerQueryContextIsComplete } from "./app-server/query/keys";
import { AppServerSharedQueries } from "./app-server/query/shared-queries";
import { createThreadCatalog, type ThreadCatalog, type ThreadCatalogEvent } from "./app-server/query/thread-catalog";
import { VIEW_TYPE_CODEX_THREADS, VIEW_TYPE_CODEX_TURN_DIFF } from "./constants";
import { hasPendingRequests } from "./domain/pending-requests/aggregate";
import type {
  ChatPanelClientSurface,
  ChatPanelSettingsAccess,
  ChatSharedThreadSurface,
  ChatViewLifecycleSurface,
  ChatWorkspacePanelSurface,
  CodexChatHost,
} from "./features/chat/host/contracts";
import { openThreadPicker, type ThreadPickerHost } from "./features/thread-picker/modal.obsidian";
import type { ThreadsViewHost, ThreadsViewSettingsAccess } from "./features/threads-view/session";
import type { ThreadsViewPanelActivity } from "./features/threads-view/state";
import { CodexThreadsView } from "./features/threads-view/view.obsidian";
import { persistedTurnDiffViewState, type TurnDiffViewState } from "./features/turn-diff/model";
import { CodexTurnDiffView } from "./features/turn-diff/view.obsidian";
import type { CodexPanelSettingTabHost } from "./settings/host";
import type { CodexPanelSettings } from "./settings/model";
import { WorkspacePanelCoordinator } from "./workspace/panel-coordinator";

interface CodexPanelRuntimeSettingsRef {
  readonly settings: CodexPanelSettings;
  readonly vaultPath: string;
}

export interface CodexPanelRuntimeOptions {
  app: App;
  settingsRef: CodexPanelRuntimeSettingsRef;
  saveSettings(): Promise<void>;
}

export class CodexPanelRuntime implements AppServerClientAccess {
  private readonly appServerQueries = new AppServerQueryCache({
    clientRunner: {
      runWithClient: (context, operation, options) => this.runWithAppServerClient(context, operation, options),
    },
  });
  private readonly appServerSharedQueries = new AppServerSharedQueries({
    cache: this.appServerQueries,
    context: () => this.appServerQueryContext(),
  });
  private readonly panels: WorkspacePanelCoordinator;
  private readonly threadCatalog: ThreadCatalog;

  constructor(private readonly options: CodexPanelRuntimeOptions) {
    this.panels = new WorkspacePanelCoordinator({
      app: options.app,
      refreshThreadsViewLiveState: () => {
        this.refreshThreadsViewLiveState();
      },
    });
    this.threadCatalog = createThreadCatalog({
      store: this.appServerSharedQueries,
      onEventApplied: (event) => {
        this.applyThreadCatalogSurfaceEvent(event);
      },
    });
  }

  reset(): void {
    this.panels.reset();
    this.appServerQueries.clear();
  }

  reconcileWorkspacePanels(leaf: Parameters<WorkspacePanelCoordinator["reconcileWorkspacePanels"]>[0]): void {
    this.panels.reconcileWorkspacePanels(leaf);
  }

  activatePanel(): Promise<unknown> {
    return this.panels.activateView();
  }

  activateNewPanel(): Promise<unknown> {
    return this.panels.activateNewView();
  }

  async startNewChat(): Promise<void> {
    const view = await this.panels.activateView();
    const surface: ChatWorkspacePanelSurface = view.surface;
    await surface.startNewThread();
  }

  openThreadPicker(): void {
    void openThreadPicker(this.threadPickerHost());
  }

  async activateThreadsView(): Promise<CodexThreadsView> {
    const leaf = await this.options.app.workspace.ensureSideLeaf(VIEW_TYPE_CODEX_THREADS, "left", {
      active: true,
      reveal: true,
    });
    const view = leaf.view as CodexThreadsView;
    await view.refresh();
    return view;
  }

  scheduleWorkspacePanelReconcile(): void {
    this.panels.scheduleWorkspacePanelReconcile();
  }

  cancelWorkspacePanelReconcile(): void {
    this.panels.cancelWorkspacePanelReconcile();
  }

  chatHost(): CodexChatHost {
    return {
      settingsRef: {
        settings: this.chatSettings(),
        vaultPath: this.options.settingsRef.vaultPath,
      },
      workspace: {
        openThreadInNewView: (threadId) => this.panels.openThreadInNewView(threadId),
        focusThreadInOpenView: (threadId) => this.panels.focusThreadInOpenView(threadId),
        openTurnDiff: (state) => this.openTurnDiff(state),
        refreshThreadsViewLiveState: () => {
          this.refreshThreadsViewLiveState();
        },
      },
      appServerQueries: this.appServerSharedQueries,
      threadCatalog: this.threadCatalog,
    };
  }

  private chatSettings(): ChatPanelSettingsAccess {
    return {
      archiveExportEnabled: () => this.options.settingsRef.settings.archiveExportEnabled,
      archiveExportSettings: () => ({
        archiveExportFolderTemplate: this.options.settingsRef.settings.archiveExportFolderTemplate,
        archiveExportFilenameTemplate: this.options.settingsRef.settings.archiveExportFilenameTemplate,
        archiveExportTags: this.options.settingsRef.settings.archiveExportTags,
      }),
      codexPath: () => this.options.settingsRef.settings.codexPath,
      scrollThreadFromComposerEdges: () => this.options.settingsRef.settings.scrollThreadFromComposerEdges,
      sendShortcut: () => this.options.settingsRef.settings.sendShortcut,
      showToolbar: () => this.options.settingsRef.settings.showToolbar,
      threadNamingEffort: () => this.options.settingsRef.settings.threadNamingEffort,
      threadNamingModel: () => this.options.settingsRef.settings.threadNamingModel,
    };
  }

  threadsHost(): ThreadsViewHost {
    return {
      settings: this.threadsSettings(),
      vaultPath: this.options.settingsRef.vaultPath,
      clientAccess: this,
      threadCatalog: this.threadCatalog,
      openNewPanel: () => this.panels.openNewPanel(),
      openThreadInAvailableView: (threadId) => this.panels.openThreadInAvailableView(threadId),
      openPanelActivities: () => this.openPanelActivities(),
    };
  }

  private threadsSettings(): ThreadsViewSettingsAccess {
    return {
      archiveExportEnabled: () => this.options.settingsRef.settings.archiveExportEnabled,
      codexPath: () => this.options.settingsRef.settings.codexPath,
      threadNamingModel: () => this.options.settingsRef.settings.threadNamingModel,
      threadNamingEffort: () => this.options.settingsRef.settings.threadNamingEffort,
      archiveExportSettings: () => ({
        archiveExportFolderTemplate: this.options.settingsRef.settings.archiveExportFolderTemplate,
        archiveExportFilenameTemplate: this.options.settingsRef.settings.archiveExportFilenameTemplate,
        archiveExportTags: this.options.settingsRef.settings.archiveExportTags,
      }),
    };
  }

  settingTabHost(): CodexPanelSettingTabHost {
    return {
      settings: this.options.settingsRef.settings,
      vaultPath: this.options.settingsRef.vaultPath,
      clientAccess: this,
      saveSettings: () => this.options.saveSettings(),
      refreshOpenViews: () => {
        this.refreshOpenViews();
      },
      appServerQueries: this.appServerSharedQueries,
      threadCatalog: this.threadCatalog,
    };
  }

  private threadPickerHost(): ThreadPickerHost {
    return {
      app: this.options.app,
      threadCatalog: this.threadCatalog,
      openThreadInCurrentView: (threadId) => this.panels.openThreadInCurrentView(threadId),
      openThreadInAvailableView: (threadId) => this.panels.openThreadInAvailableView(threadId),
    };
  }

  withClient<T>(operation: (client: AppServerClient) => Promise<T>, options: AppServerClientAccessOptions = {}): Promise<T> {
    return this.runWithAppServerClient(this.appServerQueryContext(), operation, options);
  }

  private async openTurnDiff(state: TurnDiffViewState): Promise<void> {
    const existing = this.options.app.workspace.getLeavesOfType(VIEW_TYPE_CODEX_TURN_DIFF).at(0);
    const leaf = existing ?? this.options.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE_CODEX_TURN_DIFF, active: true, state: { ...persistedTurnDiffViewState(state) } });
    await leaf.loadIfDeferred();
    if (leaf.view instanceof CodexTurnDiffView) {
      leaf.view.setDiffPayload(state);
    }
    await this.options.app.workspace.revealLeaf(leaf);
  }

  private refreshOpenViews(): void {
    for (const view of this.panels.panelViews()) {
      const surface: ChatViewLifecycleSurface = view.surface;
      surface.refreshSettings();
    }
  }

  private applyThreadArchived(threadId: string, archiveOptions: { closeOpenPanels?: boolean } = {}): void {
    const leavesToClose = archiveOptions.closeOpenPanels ? this.panels.panelLeavesForThread(threadId) : [];
    for (const view of this.panels.panelViews()) {
      const surface: ChatSharedThreadSurface = view.surface;
      surface.applyThreadArchived(threadId);
    }
    for (const leaf of leavesToClose) {
      leaf.detach();
    }
  }

  private applyThreadRenamed(threadId: string, name: string | null): void {
    for (const view of this.panels.panelViews()) {
      const surface: ChatSharedThreadSurface = view.surface;
      surface.applyThreadRenamed(threadId, name);
    }
  }

  private applyThreadCatalogSurfaceEvent(event: ThreadCatalogEvent): void {
    switch (event.type) {
      case "thread-archived":
        this.applyThreadArchived(event.threadId, event.options);
        return;
      case "thread-renamed":
        this.applyThreadRenamed(event.threadId, event.name);
        return;
      default:
        return;
    }
  }

  private refreshThreadsViewLiveState(): void {
    for (const view of this.threadsViews()) {
      view.refreshLiveState();
    }
  }

  private openPanelActivities(): readonly ThreadsViewPanelActivity[] {
    return this.panels.getOpenPanelSnapshots().map((snapshot) => ({
      threadId: snapshot.threadId,
      selected: snapshot.lastFocused,
      pending: hasPendingRequests(snapshot.pendingRequests),
      running: snapshot.turnLifecycle.kind !== "idle",
    }));
  }

  private threadsViews(): CodexThreadsView[] {
    return this.options.app.workspace
      .getLeavesOfType(VIEW_TYPE_CODEX_THREADS)
      .flatMap((leaf) => (leaf.view instanceof CodexThreadsView ? [leaf.view] : []));
  }

  private async runWithAppServerClient<T>(
    context: AppServerQueryContext,
    operation: (client: AppServerClient) => Promise<T>,
    options: AppServerClientAccessOptions = {},
  ): Promise<T> {
    if (!appServerQueryContextIsComplete(context)) {
      throw new Error("Codex app-server query context is incomplete.");
    }
    if (options.serverRequests?.kind === "reject") {
      return withShortLivedAppServerClient(context.codexPath, context.vaultPath, operation, options);
    }
    const chatSurface = this.connectedClientSurface(context);
    if (chatSurface) return chatSurface.runWithAppServerClient(operation);
    return withShortLivedAppServerClient(context.codexPath, context.vaultPath, operation, options);
  }

  private connectedClientSurface(context: AppServerQueryContext): ChatPanelClientSurface | null {
    for (const view of this.panels.panelViews()) {
      const workspaceSurface: ChatWorkspacePanelSurface = view.surface;
      if (!workspaceSurface.openPanelSnapshot().connected) continue;
      const clientSurface: ChatPanelClientSurface = view.surface;
      if (!clientSurface.canServeAppServerContext(context)) continue;
      return clientSurface;
    }
    return null;
  }

  private appServerQueryContext(): AppServerQueryContext {
    return {
      codexPath: this.options.settingsRef.settings.codexPath,
      vaultPath: this.options.settingsRef.vaultPath,
    };
  }
}
