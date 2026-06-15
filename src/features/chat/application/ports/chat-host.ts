import type { CodexPanelSettings } from "../../../../settings/model";
import type { SharedThreadCatalog } from "../../../../workspace/shared-thread-catalog";
import type { ChatTurnDiffViewState } from "../../domain/turn-diff";

export interface CodexChatHost {
  readonly settingsRef: PluginSettingsRef;
  readonly workspace: WorkspacePanels;
  readonly threadCatalog: ThreadCatalogFacade;
}

export interface PluginSettingsRef {
  readonly settings: CodexPanelSettings;
  readonly vaultPath: string;
}

export interface WorkspacePanels {
  openThreadInNewView(threadId: string): Promise<unknown>;
  focusThreadInOpenView(threadId: string): Promise<boolean>;
  openTurnDiff(state: ChatTurnDiffViewState): Promise<void>;
}

export type ThreadCatalogFacade = Pick<
  SharedThreadCatalog,
  | "archiveThreadInCatalog"
  | "renameThreadInCatalog"
  | "refreshThreadsViewLiveState"
  | "refreshFromOpenSurface"
  | "setActiveThreads"
  | "setAppServerMetadata"
  | "fetchActiveThreads"
  | "activeThreadsSnapshot"
  | "appServerMetadataSnapshot"
  | "modelsSnapshot"
  | "observeActiveThreads"
  | "observeAppServerMetadata"
  | "observeModels"
>;
