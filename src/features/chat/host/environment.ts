import type { App, Component, EventRef } from "obsidian";

import type { ArchiveExportDestination } from "../../../app-server/services/thread-archive-markdown";
import type { ModelMetadata } from "../../../domain/catalog/metadata";
import type { ObservedResultListener } from "../../../domain/observed-result";
import type { SharedServerMetadata } from "../../../domain/server/metadata";
import type { CodexPanelSettings } from "../../../settings/model";
import type { ThreadCatalogActiveReader, ThreadCatalogEventSink } from "../../../workspace/thread-catalog";
import type { ChatTurnDiffViewState } from "../domain/turn-diff";

export interface CodexChatHost {
  readonly settingsRef: PluginSettingsRef;
  readonly workspace: WorkspacePanels;
  readonly appServerQueries: ChatAppServerQueries;
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

type ChatThreadCatalog = ThreadCatalogActiveReader & ThreadCatalogEventSink;

interface ChatAppServerQueries {
  updateAppServerMetadata(updater: (metadata: SharedServerMetadata | null) => SharedServerMetadata | null): SharedServerMetadata | null;
  appServerMetadataSnapshot(): SharedServerMetadata | null;
  refreshAppServerMetadata(options?: { forceSkills?: boolean }): Promise<SharedServerMetadata | null>;
  observeAppServerMetadataResult(listener: ObservedResultListener<SharedServerMetadata>, options?: { emitCurrent?: boolean }): () => void;
  modelsSnapshot(): readonly ModelMetadata[] | null;
  fetchModels(): Promise<readonly ModelMetadata[]>;
  refreshModels(): Promise<readonly ModelMetadata[]>;
  observeModelsResult(listener: ObservedResultListener<readonly ModelMetadata[]>, options?: { emitCurrent?: boolean }): () => void;
}

export interface ChatPanelEnvironment {
  obsidian: {
    app: App;
    owner: Component;
    viewId: string;
    registerEvent: (eventRef: EventRef) => void;
    registerPointerDown: (handler: (event: PointerEvent) => void) => void;
    archiveDestination: () => ArchiveExportDestination;
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
