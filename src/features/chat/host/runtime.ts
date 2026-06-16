import type { App, Component, EventRef } from "obsidian";

import type { AppServerSharedQueries } from "../../../app-server/query/shared-queries";
import type { ArchiveExportAdapter } from "../../../app-server/services/thread-archive-markdown";
import type { CodexPanelSettings } from "../../../settings/model";
import type { ActiveThreadCatalog } from "../../../workspace/active-thread-catalog";
import type { ChatTurnDiffViewState } from "../domain/turn-diff";

export interface CodexChatHost {
  readonly settingsRef: PluginSettingsRef;
  readonly workspace: WorkspacePanels;
  readonly appServerData: ChatAppServerData;
  readonly threadCatalog: ChatThreadCatalog;
}

export interface PluginSettingsRef {
  readonly settings: CodexPanelSettings;
  readonly vaultPath: string;
}

interface WorkspacePanels {
  openThreadInNewView(threadId: string): Promise<unknown>;
  focusThreadInOpenView(threadId: string): Promise<boolean>;
  openTurnDiff(state: ChatTurnDiffViewState): Promise<void>;
  refreshThreadsViewLiveState(): void;
}

type ChatThreadCatalog = ActiveThreadCatalog;

type ChatAppServerData = Pick<
  AppServerSharedQueries,
  | "updateAppServerMetadata"
  | "appServerMetadataSnapshot"
  | "refreshAppServerMetadata"
  | "modelsSnapshot"
  | "fetchModels"
  | "refreshModels"
  | "observeAppServerMetadataResult"
  | "observeModelsResult"
>;

export interface ChatPanelEnvironment {
  obsidian: {
    app: App;
    owner: Component;
    viewId: string;
    registerEvent: (eventRef: EventRef) => void;
    registerPointerDown: (handler: (event: PointerEvent) => void) => void;
    archiveAdapter: () => ArchiveExportAdapter;
    requestWorkspaceLayoutSave: () => void;
  };
  plugin: CodexChatHost;
  view: {
    panelRoot: () => HTMLElement | null;
    viewWindow: () => Window | null;
    containsElement: (element: Element) => boolean;
    refreshTabHeader: () => void;
  };
}
