import type { App } from "obsidian";
import type { AppServerClient } from "./app-server/connection/client";
import type { AppServerClientAccess, AppServerClientAccessOptions } from "./app-server/connection/client-access";
import { withShortLivedAppServerClient } from "./app-server/connection/short-lived-client";
import {
  type AppServerContextLease,
  type AppServerQueryContext,
  type AppServerQueryContextIdentity,
  appServerQueryContextIdentityMatches,
  appServerQueryContextIsComplete,
} from "./app-server/query/keys";
import { AppServerResourceStore, StaleAppServerResourceContextError } from "./app-server/query/resource-store";
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
import type { SelectionRewriteCommandController } from "./features/selection-rewrite/command.obsidian";
import { openThreadPicker, type ThreadPickerHost } from "./features/thread-picker/modal.obsidian";
import { createThreadOperationsTransport, createThreadTitleTransport } from "./features/threads/app-server/workflow-transports";
import { createThreadCatalog, type ThreadCatalog, type ThreadCatalogEvent } from "./features/threads/catalog/thread-catalog";
import { createThreadNameMutationCoordinator } from "./features/threads/workflows/thread-name-mutation-coordinator";
import type { ThreadsViewHost, ThreadsViewSettingsAccess } from "./features/threads-view/session";
import type { ThreadsViewPanelActivity } from "./features/threads-view/state";
import { CodexThreadsView } from "./features/threads-view/view.obsidian";
import { persistedTurnDiffViewState, type TurnDiffViewState } from "./features/turn-diff/model";
import { CodexTurnDiffView } from "./features/turn-diff/view.obsidian";
import { createSettingsAppServerDynamicData } from "./settings/app-server-dynamic-data";
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
  saveSettings(settings: CodexPanelSettings): Promise<void>;
}

export class CodexPanelRuntime implements AppServerClientAccess {
  private readonly appServerResourceStore = new AppServerResourceStore({
    clientRunner: {
      runWithClient: (context, operation, options) => this.runWithAppServerClient(context, operation, options),
    },
  });
  private readonly panels: WorkspacePanelCoordinator;
  private readonly threadCatalog: ThreadCatalog;
  private readonly threadNameMutations = createThreadNameMutationCoordinator();
  private selectionRewriteController: SelectionRewriteCommandController | null = null;

  constructor(private readonly options: CodexPanelRuntimeOptions) {
    this.panels = new WorkspacePanelCoordinator({
      app: options.app,
      refreshThreadsViewLiveState: () => {
        this.refreshThreadsViewLiveState();
      },
    });
    this.threadCatalog = createThreadCatalog({
      store: this.appServerResourceStore,
      onEventApplied: (event) => {
        this.applyThreadCatalogSurfaceEvent(event);
      },
    });
  }

  initialize(): void {
    this.appServerResourceStore.initialize(this.configuredAppServerContext());
  }

  appServerContextLease(): AppServerContextLease {
    return this.appServerResourceStore.contextLease();
  }

  reset(): void {
    this.selectionRewriteController?.closeAll();
    this.selectionRewriteController = null;
    this.panels.reset();
    this.appServerResourceStore.reset();
    this.threadCatalog.clear();
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

  setSelectionRewriteController(controller: SelectionRewriteCommandController): void {
    this.selectionRewriteController = controller;
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
        openSideChat: (sourceThreadId, sourceThreadTitle) => this.panels.openSideChat(sourceThreadId, sourceThreadTitle),
        refreshThreadsViewLiveState: () => {
          this.refreshThreadsViewLiveState();
        },
      },
      appServerQueries: this.appServerResourceStore,
      threadCatalog: this.threadCatalog,
      threadNameMutations: this.threadNameMutations,
    };
  }

  private chatSettings(): ChatPanelSettingsAccess {
    return {
      referenceActiveNoteOnSend: () => this.options.settingsRef.settings.referenceActiveNoteOnSend,
      attachmentFolder: () => this.options.settingsRef.settings.attachmentFolder,
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
      appServerContextLease: () => this.appServerResourceStore.contextLease(),
      threadCatalog: this.threadCatalog,
      threadNameMutations: this.threadNameMutations,
      threadOperationsTransport: createThreadOperationsTransport(this),
      threadTitleTransport: createThreadTitleTransport({
        clientAccess: this,
        codexPath: () => this.appServerResourceStore.contextLease().context.codexPath,
        vaultPath: this.appServerResourceStore.contextLease().context.vaultPath,
        threadNamingModel: () => this.options.settingsRef.settings.threadNamingModel,
        threadNamingEffort: () => this.options.settingsRef.settings.threadNamingEffort,
      }),
      openNewPanel: () => this.panels.openNewPanel(),
      openThreadInAvailableView: (threadId) => this.panels.openThreadInAvailableView(threadId),
      openPanelActivities: () => this.openPanelActivities(),
      closeOpenPanelsForThread: (threadId) => {
        this.closeOpenPanelsForThread(threadId);
      },
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
      dynamicData: createSettingsAppServerDynamicData({
        vaultPath: this.options.settingsRef.vaultPath,
        clientAccess: this,
        appServerQueries: this.appServerResourceStore,
        threadCatalog: this.threadCatalog,
      }),
      publishSettings: (settings) => this.publishSettings(settings),
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
    return this.runWithAppServerClient(this.appServerResourceStore.contextIdentity(), operation, options);
  }

  private async publishSettings(settings: CodexPanelSettings): Promise<{ appServerContextReplaced: boolean }> {
    const previousSettings = { ...this.options.settingsRef.settings };
    await this.options.saveSettings(settings);
    const appServerContextReplaced = previousSettings.codexPath !== settings.codexPath;
    if (appServerContextReplaced) this.prepareAppServerContextChange();
    Object.assign(this.options.settingsRef.settings, settings);
    if (appServerContextReplaced) this.appServerResourceStore.replaceContext(this.configuredAppServerContext());
    if (appServerContextReplaced || previousSettings.showToolbar !== settings.showToolbar) this.refreshOpenViews();
    return { appServerContextReplaced };
  }

  private prepareAppServerContextChange(): void {
    this.selectionRewriteController?.closeAll();
    for (const view of this.panels.panelViews()) view.surface.prepareAppServerContextChange();
    for (const view of this.threadsViews()) view.prepareAppServerContextChange();
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
    for (const view of this.threadsViews()) view.refreshSettings();
  }

  private applyThreadArchived(threadId: string): void {
    for (const view of this.panels.panelViews()) {
      const surface: ChatSharedThreadSurface = view.surface;
      surface.applyThreadArchived(threadId);
    }
  }

  private closeOpenPanelsForThread(threadId: string): void {
    const leavesToClose = this.panels.panelLeavesForThread(threadId);
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
        this.applyThreadArchived(event.threadId);
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
    context: AppServerQueryContextIdentity,
    operation: (client: AppServerClient) => Promise<T>,
    options: AppServerClientAccessOptions = {},
  ): Promise<T> {
    if (!appServerQueryContextIsComplete(context)) {
      throw new Error("Codex app-server query context is incomplete.");
    }
    this.assertCurrentAppServerContext(context);
    const result = await this.runWithContextClient(
      context,
      (client) => {
        this.assertCurrentAppServerContext(context);
        return operation(client);
      },
      options,
    );
    this.assertCurrentAppServerContext(context);
    return result;
  }

  private assertCurrentAppServerContext(context: AppServerQueryContextIdentity): void {
    let current = false;
    try {
      current = appServerQueryContextIdentityMatches(this.appServerResourceStore.contextIdentity(), context);
    } catch {
      // A reset resource store has no current app-server context.
    }
    if (!current) throw new StaleAppServerResourceContextError();
  }

  private runWithContextClient<T>(
    context: AppServerQueryContextIdentity,
    operation: (client: AppServerClient) => Promise<T>,
    options: AppServerClientAccessOptions,
  ): Promise<T> {
    if (options.serverRequests?.kind === "reject") {
      return withShortLivedAppServerClient(context.codexPath, context.vaultPath, operation, options);
    }
    const chatSurface = this.connectedClientSurface(context);
    return chatSurface
      ? chatSurface.runWithAppServerClient(operation)
      : withShortLivedAppServerClient(context.codexPath, context.vaultPath, operation, options);
  }

  private connectedClientSurface(context: AppServerQueryContextIdentity): ChatPanelClientSurface | null {
    for (const view of this.panels.panelViews()) {
      const workspaceSurface: ChatWorkspacePanelSurface = view.surface;
      if (!workspaceSurface.openPanelSnapshot().connected) continue;
      const clientSurface: ChatPanelClientSurface = view.surface;
      if (!clientSurface.canServeAppServerContext(context)) continue;
      return clientSurface;
    }
    return null;
  }

  private configuredAppServerContext(): AppServerQueryContext {
    return {
      codexPath: this.options.settingsRef.settings.codexPath,
      vaultPath: this.options.settingsRef.vaultPath,
    };
  }
}
