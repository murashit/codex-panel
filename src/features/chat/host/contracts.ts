import type { App, Component, EventRef } from "obsidian";

import type { AppServerClient } from "../../../app-server/connection/client";
import type { AppServerContextLease, AppServerQueryContextIdentity } from "../../../app-server/query/keys";
import type { ObservedResultListener } from "../../../app-server/query/observed-result";
import type { ModelMetadata, ReasoningEffort } from "../../../domain/catalog/metadata";
import type { SendShortcut } from "../../../domain/input/send-shortcut";
import type { PendingRequestCounts } from "../../../domain/pending-requests/aggregate";
import type { SharedServerMetadata } from "../../../domain/server/metadata";
import type { ArchiveExportSettings } from "../../../domain/threads/archive-markdown";
import type {
  ThreadCatalogActiveReader,
  ThreadCatalogConnectionEventSink,
  ThreadCatalogEventSink,
} from "../../threads/catalog/thread-catalog";
import type { ArchiveExportDestination } from "../../threads/workflows/archive-export";
import type { ThreadNameMutationCoordinator } from "../../threads/workflows/thread-name-mutation-coordinator";
import type { TurnDiffViewState } from "../../turn-diff/model";

export interface CodexChatHost {
  readonly settingsRef: ChatPanelSettingsRef;
  readonly workspace: WorkspacePanels;
  readonly appServerQueries: ChatAppServerQueries;
  readonly threadCatalog: ChatThreadCatalog;
  readonly threadNameMutations: ThreadNameMutationCoordinator;
}

interface ChatPanelSettingsRef {
  readonly settings: ChatPanelSettingsAccess;
  readonly vaultPath: string;
}

export interface ChatPanelSettingsAccess {
  referenceActiveNoteOnSend(): boolean;
  attachmentFolder(): string;
  archiveExportEnabled(): boolean;
  archiveExportSettings(): ArchiveExportSettings;
  codexPath(): string;
  scrollThreadFromComposerEdges(): boolean;
  sendShortcut(): SendShortcut;
  showToolbar(): boolean;
  threadNamingEffort(): ReasoningEffort | null;
  threadNamingModel(): string | null;
}

interface WorkspacePanels {
  openThreadInNewView(threadId: string): Promise<void>;
  focusThreadInOpenView(threadId: string): Promise<boolean>;
  openTurnDiff(state: TurnDiffViewState): Promise<void>;
  refreshThreadsViewLiveState(): void;
  openSideChat(sourceThreadId: string, sourceThreadTitle: string | null): Promise<void>;
}

type ChatThreadCatalog = ThreadCatalogActiveReader & ThreadCatalogEventSink & ThreadCatalogConnectionEventSink;

interface ChatAppServerQueries {
  contextLease(): AppServerContextLease;
  appServerMetadataSnapshot(): SharedServerMetadata | null;
  refreshAppServerMetadata(): Promise<SharedServerMetadata | null>;
  refreshSkills(): Promise<SharedServerMetadata | null>;
  refreshRateLimits(): Promise<SharedServerMetadata | null>;
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
  close(): Promise<void>;
  prepareAppServerContextChange(): void;
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
  openSideChat(input: { sourceThreadId: string; sourceThreadTitle: string | null }): Promise<boolean>;
}

export interface ChatSharedThreadSurface {
  refreshSharedThreads(): Promise<void>;
  applyThreadArchived(threadId: string): void;
  applyThreadRenamed(threadId: string, name: string | null): void;
}

export interface ChatPanelClientSurface {
  canServeAppServerContext(context: AppServerQueryContextIdentity): boolean;
  runWithAppServerClient<T>(operation: (client: AppServerClient) => Promise<T>): Promise<T>;
}

export type ChatPanelHandle = ChatViewLifecycleSurface &
  ChatWorkspacePanelSurface &
  ChatSharedThreadSurface &
  ChatPanelClientSurface & {
    setComposerText(text: string): void;
  };
