import type { App } from "obsidian";

import { VIEW_TYPE_CODEX_THREADS } from "../constants";
import { CodexThreadsView } from "../features/threads-view/view";
import type { WorkspacePanelCoordinator } from "./panel-coordinator";

export interface ThreadSurfaceActionsOptions {
  app: App;
  panels: WorkspacePanelCoordinator;
}

export interface ThreadSurfaceActions {
  refreshOpenViews(): void;
  invalidateThreadsFromOpenSurface(): void;
  applyThreadArchived(threadId: string, options?: { closeOpenPanels?: boolean }): void;
  applyThreadRenamed(threadId: string, name: string | null): void;
  refreshThreadsViewLiveState(): void;
}

export function createThreadSurfaceActions(options: ThreadSurfaceActionsOptions): ThreadSurfaceActions {
  const threadsViews = (): CodexThreadsView[] =>
    options.app.workspace
      .getLeavesOfType(VIEW_TYPE_CODEX_THREADS)
      .flatMap((leaf) => (leaf.view instanceof CodexThreadsView ? [leaf.view] : []));

  const invalidateThreadsFromOpenSurface = (): void => {
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

    invalidateThreadsFromOpenSurface,

    applyThreadArchived(threadId: string, archiveOptions: { closeOpenPanels?: boolean } = {}): void {
      const leavesToClose = archiveOptions.closeOpenPanels ? options.panels.panelLeavesForThread(threadId) : [];
      for (const view of options.panels.panelViews()) {
        view.surface.applyThreadArchived(threadId);
      }
      for (const leaf of leavesToClose) {
        leaf.detach();
      }
    },

    applyThreadRenamed(threadId: string, name: string | null): void {
      for (const view of options.panels.panelViews()) {
        view.surface.applyThreadRenamed(threadId, name);
      }
    },

    refreshThreadsViewLiveState(): void {
      for (const view of threadsViews()) {
        view.refreshLiveState();
      }
    },
  };
}
