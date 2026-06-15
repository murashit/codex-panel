import type { App } from "obsidian";

import { VIEW_TYPE_CODEX_THREADS } from "../constants";
import { CodexThreadsView } from "../features/threads-view/view";
import type { ModelMetadata } from "../domain/catalog/metadata";
import type { Thread } from "../domain/threads/model";
import type { SharedServerMetadata } from "../domain/server/metadata";
import type { WorkspacePanelCoordinator } from "./panel-coordinator";

export interface ThreadSurfaceActionsOptions {
  app: App;
  panels: WorkspacePanelCoordinator;
}

export interface ThreadSurfaceActions {
  refreshOpenViews(): void;
  refreshSharedThreadListFromOpenSurface(): void;
  applyThreadListSnapshot(threads: readonly Thread[]): void;
  publishAppServerMetadata(metadata: SharedServerMetadata): void;
  publishModels(models: readonly ModelMetadata[]): void;
  refreshThreadsViewLiveState(): void;
  notifyThreadArchived(threadId: string, options?: { closeOpenPanels?: boolean }): void;
  notifyThreadRenamed(threadId: string, name: string | null): void;
}

export function createThreadSurfaceActions(options: ThreadSurfaceActionsOptions): ThreadSurfaceActions {
  const threadsViews = (): CodexThreadsView[] =>
    options.app.workspace
      .getLeavesOfType(VIEW_TYPE_CODEX_THREADS)
      .flatMap((leaf) => (leaf.view instanceof CodexThreadsView ? [leaf.view] : []));

  const refreshSharedThreadListFromOpenSurface = (): void => {
    const chatView = options.panels.panelViews().find((view) => view.surface.openPanelSnapshot().connected);
    if (chatView) {
      void chatView.surface.refreshSharedThreadList();
      return;
    }

    const threadsView = threadsViews().at(0);
    if (threadsView) void threadsView.refresh();
  };

  return {
    refreshOpenViews(): void {
      for (const view of options.panels.panelViews()) {
        view.surface.refreshSettings();
      }
    },

    refreshSharedThreadListFromOpenSurface,

    applyThreadListSnapshot(threads: readonly Thread[]): void {
      for (const view of options.panels.panelViews()) {
        view.surface.applyThreadListSnapshot(threads);
      }
      for (const view of threadsViews()) {
        view.applyThreadListSnapshot(threads);
      }
    },

    publishAppServerMetadata(metadata: SharedServerMetadata): void {
      for (const view of options.panels.panelViews()) {
        view.surface.applyAppServerMetadataSnapshot(metadata);
      }
    },

    publishModels(models: readonly ModelMetadata[]): void {
      for (const view of options.panels.panelViews()) {
        view.surface.applyAvailableModelsSnapshot(models);
      }
    },

    refreshThreadsViewLiveState(): void {
      for (const view of threadsViews()) {
        view.refreshLiveState();
      }
    },

    notifyThreadArchived(threadId: string, archiveOptions: { closeOpenPanels?: boolean } = {}): void {
      const leavesToClose = archiveOptions.closeOpenPanels ? options.panels.panelLeavesForThread(threadId) : [];
      for (const view of options.panels.panelViews()) {
        view.surface.notifyThreadArchived(threadId);
      }
      for (const leaf of leavesToClose) {
        leaf.detach();
      }
      refreshSharedThreadListFromOpenSurface();
    },

    notifyThreadRenamed(threadId: string, name: string | null): void {
      for (const view of options.panels.panelViews()) {
        view.surface.notifyThreadRenamed(threadId, name);
      }
      refreshSharedThreadListFromOpenSurface();
    },
  };
}
