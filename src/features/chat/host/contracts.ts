import type { App, Component, EventRef } from "obsidian";

import type { AppServerClient } from "../../../app-server/connection/client";
import type { AppServerQueryContext } from "../../../app-server/query/keys";
import type { ThreadCatalogActiveReader, ThreadCatalogEventSink } from "../../../app-server/query/thread-catalog";
import type { ArchiveExportDestination } from "../../../app-server/services/thread-archive-markdown";
import type { ModelMetadata } from "../../../domain/catalog/metadata";
import type { PendingRequestCounts } from "../../../domain/pending-requests/aggregate";
import type { SharedServerMetadata } from "../../../domain/server/metadata";
import type { CodexPanelSettings } from "../../../settings/model";
import type { ObservedResultListener } from "../../../shared/query/observed-result";
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
  openThreadInNewView(threadId: string): Promise<void>;
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
    refreshTabHeader: () => void;
  };
}

export interface ChatViewLifecycleSurface {
  displayTitle(): string;
  persistedState(): Record<string, unknown>;
  applyViewState(state: unknown): void;
  open(): void;
  close(): void;
  refreshSettings(): void;
}

export type ChatWorkspacePanelTurnLifecycle = { kind: "idle" } | { kind: "starting" } | { kind: "running"; turnId: string };

export interface ChatWorkspacePanelSnapshot {
  viewId: string;
  threadId: string | null;
  turnLifecycle: ChatWorkspacePanelTurnLifecycle;
  pendingRequests: PendingRequestCounts;
  hasComposerDraft: boolean;
  connected: boolean;
}

export interface ChatWorkspacePanelSurface {
  openPanelSnapshot(): ChatWorkspacePanelSnapshot;
  openThread(threadId: string): Promise<void>;
  focusThread(threadId?: string | null): Promise<void>;
  hydrateRestoredThread(): Promise<void>;
  focusComposer(): void;
  connect(): Promise<void>;
  startNewThread(): Promise<void>;
}

export interface ChatSharedThreadSurface {
  refreshSharedThreads(): Promise<void>;
  applyThreadArchived(threadId: string): void;
  applyThreadRenamed(threadId: string, name: string | null): void;
}

export interface ChatPanelClientSurface {
  canServeAppServerContext(context: AppServerQueryContext): boolean;
  runWithAppServerClient<T>(operation: (client: AppServerClient) => Promise<T>): Promise<T>;
}

export type ChatPanelHandle = ChatViewLifecycleSurface &
  ChatWorkspacePanelSurface &
  ChatSharedThreadSurface &
  ChatPanelClientSurface & {
    setComposerText(text: string): void;
  };
