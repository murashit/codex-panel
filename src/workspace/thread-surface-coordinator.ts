import type { App } from "obsidian";

import { VIEW_TYPE_CODEX_THREADS } from "../constants";
import { CodexThreadsView } from "../features/threads-view/view";
import type { ModelMetadata } from "../domain/catalog/metadata";
import type { Thread } from "../domain/threads/model";
import type { SharedAppServerMetadata } from "../app-server/shared-cache-state";
import type { WorkspacePanelCoordinator } from "./panel-coordinator";

export interface ThreadSurfaceCoordinatorOptions {
  app: App;
  panels: WorkspacePanelCoordinator;
  refreshThreadSurfaces: () => void;
}

export class ThreadSurfaceCoordinator {
  constructor(private readonly options: ThreadSurfaceCoordinatorOptions) {}

  refreshOpenViews(): void {
    for (const view of this.options.panels.panelViews()) {
      view.refreshSettings();
    }
  }

  refreshSharedThreadListFromOpenSurface(): void {
    const chatView = this.options.panels.panelViews().find((view) => view.openPanelSnapshot().connected);
    if (chatView) {
      void chatView.refreshSharedThreadList();
      return;
    }

    const threadsView = this.threadsViews().at(0);
    if (threadsView) void threadsView.refresh();
  }

  applyThreadListSnapshot(threads: readonly Thread[]): void {
    for (const view of this.options.panels.panelViews()) {
      view.applyThreadListSnapshot(threads);
    }
    for (const view of this.threadsViews()) {
      view.applyThreadListSnapshot(threads);
    }
  }

  publishAppServerMetadata(metadata: SharedAppServerMetadata): void {
    for (const view of this.options.panels.panelViews()) {
      view.applyAppServerMetadataSnapshot(metadata);
    }
  }

  publishModels(models: readonly ModelMetadata[]): void {
    for (const view of this.options.panels.panelViews()) {
      view.applyAvailableModelsSnapshot(models);
    }
  }

  refreshThreadsViewLiveState(): void {
    for (const view of this.threadsViews()) {
      view.refreshLiveState();
    }
  }

  notifyThreadArchived(threadId: string, options: { closeOpenPanels?: boolean } = {}): void {
    const leavesToClose = options.closeOpenPanels ? this.options.panels.panelLeavesForThread(threadId) : [];
    for (const view of this.options.panels.panelViews()) {
      view.notifyThreadArchived(threadId);
    }
    for (const leaf of leavesToClose) {
      leaf.detach();
    }
    this.options.refreshThreadSurfaces();
  }

  notifyThreadRenamed(threadId: string, name: string | null): void {
    for (const view of this.options.panels.panelViews()) {
      view.notifyThreadRenamed(threadId, name);
    }
    this.options.refreshThreadSurfaces();
  }

  private threadsViews(): CodexThreadsView[] {
    return this.options.app.workspace
      .getLeavesOfType(VIEW_TYPE_CODEX_THREADS)
      .flatMap((leaf) => (leaf.view instanceof CodexThreadsView ? [leaf.view] : []));
  }
}
