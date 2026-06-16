import type { App } from "obsidian";

import { VIEW_TYPE_CODEX_THREADS, VIEW_TYPE_CODEX_TURN_DIFF } from "./constants";
import { AppServerQueryCache } from "./app-server/query/cache";
import { AppServerSharedQueries } from "./app-server/query/shared-queries";
import type { AppServerClient } from "./app-server/connection/client";
import { withShortLivedAppServerClient } from "./app-server/connection/short-lived-client";
import { appServerQueryContextIsComplete, type AppServerQueryContext } from "./app-server/query/keys";
import type { ChatTurnDiffViewState } from "./features/chat/domain/turn-diff";
import type { CodexChatHost, PluginSettingsRef } from "./features/chat/host/runtime";
import type {
  ChatPanelClientSurface,
  ChatSharedThreadSurface,
  ChatViewLifecycleSurface,
  ChatWorkspacePanelSurface,
} from "./features/chat/host/surface-handle";
import { persistedChatTurnDiffViewState } from "./features/chat/domain/turn-diff";
import { CodexChatTurnDiffView } from "./features/chat/ui/turn-diff/view";
import { openThreadPicker, type ThreadPickerHost } from "./features/thread-picker/modal";
import { CodexThreadsView, type CodexThreadsHost } from "./features/threads-view/view";
import type { CodexPanelSettingTabHost } from "./settings/tab";
import { WorkspacePanelCoordinator } from "./workspace/panel-coordinator";
import { createActiveThreadCatalog, type ActiveThreadCatalog } from "./workspace/active-thread-catalog";

export interface CodexPanelRuntimeOptions {
  app: App;
  settingsRef: PluginSettingsRef;
  saveSettings(): Promise<void>;
}

export class CodexPanelRuntime {
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
  private readonly threadCatalog: ActiveThreadCatalog;

  constructor(private readonly options: CodexPanelRuntimeOptions) {
    this.panels = new WorkspacePanelCoordinator({
      app: options.app,
      refreshThreadsViewLiveState: () => {
        this.refreshThreadsViewLiveState();
      },
    });
    this.threadCatalog = createActiveThreadCatalog({
      queries: this.appServerSharedQueries,
      surfaces: {
        applyThreadArchived: (threadId, archiveOptions) => {
          this.applyThreadArchived(threadId, archiveOptions);
        },
        applyThreadRenamed: (threadId, name) => {
          this.applyThreadRenamed(threadId, name);
        },
      },
    });
  }

  reset(): void {
    this.panels.reset();
    this.appServerQueries.clear();
  }

  recordLastFocusedPanel(leaf: Parameters<WorkspacePanelCoordinator["recordLastFocusedPanel"]>[0]): void {
    this.panels.recordLastFocusedPanel(leaf);
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

  scheduleBootRestoredPanelLoads(): void {
    this.panels.scheduleBootRestoredPanelLoads();
  }

  cancelBootRestoredPanelLoads(): void {
    this.panels.cancelBootRestoredPanelLoads();
  }

  chatHost(): CodexChatHost {
    return {
      settingsRef: this.options.settingsRef,
      workspace: {
        openThreadInNewView: (threadId) => this.panels.openThreadInNewView(threadId),
        focusThreadInOpenView: (threadId) => this.panels.focusThreadInOpenView(threadId),
        openTurnDiff: (state) => this.openTurnDiff(state),
        refreshThreadsViewLiveState: () => {
          this.refreshThreadsViewLiveState();
        },
      },
      appServerData: this.appServerSharedQueries,
      threadCatalog: this.threadCatalog,
    };
  }

  threadsHost(): CodexThreadsHost {
    return {
      settings: this.options.settingsRef.settings,
      vaultPath: this.options.settingsRef.vaultPath,
      threadCatalog: this.threadCatalog,
      openNewPanel: () => this.panels.openNewPanel(),
      openThreadInAvailableView: (threadId) => this.panels.openThreadInAvailableView(threadId),
      getOpenPanelSnapshots: () => this.panels.getOpenPanelSnapshots(),
    };
  }

  settingTabHost(): CodexPanelSettingTabHost {
    return {
      settings: this.options.settingsRef.settings,
      vaultPath: this.options.settingsRef.vaultPath,
      saveSettings: () => this.options.saveSettings(),
      refreshOpenViews: () => {
        this.refreshOpenViews();
      },
      appServerData: this.appServerSharedQueries,
      threadCatalog: this.threadCatalog,
    };
  }

  private threadPickerHost(): ThreadPickerHost {
    return {
      app: this.options.app,
      settings: this.options.settingsRef.settings,
      vaultPath: this.options.settingsRef.vaultPath,
      threadCatalog: this.threadCatalog,
      openThreadInCurrentView: (threadId) => this.panels.openThreadInCurrentView(threadId),
      openThreadInAvailableView: (threadId) => this.panels.openThreadInAvailableView(threadId),
    };
  }

  private async openTurnDiff(state: ChatTurnDiffViewState): Promise<void> {
    const existing = this.options.app.workspace.getLeavesOfType(VIEW_TYPE_CODEX_TURN_DIFF).at(0);
    const leaf = existing ?? this.options.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE_CODEX_TURN_DIFF, active: true, state: { ...persistedChatTurnDiffViewState(state) } });
    await leaf.loadIfDeferred();
    if (leaf.view instanceof CodexChatTurnDiffView) {
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

  private refreshThreadsViewLiveState(): void {
    for (const view of this.threadsViews()) {
      view.refreshLiveState();
    }
  }

  private threadsViews(): CodexThreadsView[] {
    return this.options.app.workspace
      .getLeavesOfType(VIEW_TYPE_CODEX_THREADS)
      .flatMap((leaf) => (leaf.view instanceof CodexThreadsView ? [leaf.view] : []));
  }

  private async runWithAppServerClient<T>(
    context: AppServerQueryContext,
    operation: (client: AppServerClient) => Promise<T>,
    options: { unhandledServerRequestMessage?: string } = {},
  ): Promise<T> {
    if (!appServerQueryContextIsComplete(context)) {
      throw new Error("Codex app-server query context is incomplete.");
    }
    const chatSurface = this.connectedClientSurface();
    if (chatSurface) return chatSurface.runWithAppServerClient(operation);
    return withShortLivedAppServerClient(context.codexPath, context.vaultPath, operation, options);
  }

  private connectedClientSurface(): ChatPanelClientSurface | null {
    for (const view of this.panels.panelViews()) {
      const workspaceSurface: ChatWorkspacePanelSurface = view.surface;
      if (!workspaceSurface.openPanelSnapshot().connected) continue;
      const clientSurface: ChatPanelClientSurface = view.surface;
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
