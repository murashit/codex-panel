import type { App, Component, EventRef } from "obsidian";

import type { AppServerClientAccess } from "../../../app-server/connection/client-access";
import type { AppServerExecutionContext } from "../../../app-server/connection/execution-context";
import type { ModelMetadata } from "../../../domain/catalog/metadata";
import type { SendShortcut } from "../../../domain/input/send-shortcut";
import type { SharedServerMetadata, SharedServerMetadataResource } from "../../../domain/server/metadata";
import type { KeyedOperationQueue } from "../../../shared/runtime/keyed-operation-queue";
import type { ObservedResultListener } from "../../../shared/runtime/observed-result";
import type { ThreadCatalogPaginatedActiveReader } from "../../threads/catalog/thread-catalog";
import type { ArchiveExportDestination, ArchiveExportSettings } from "../../threads/workflows/archive-export";
import type { ThreadTitleTransport } from "../../threads/workflows/ports";
import type { ThreadFactCoordinator } from "../../threads/workflows/thread-fact-coordinator";
import type { TurnDiffViewState } from "../../turn-diff/model";
import type { ThreadGoalOperationCoordinator } from "../application/threads/goal-actions";

export interface CodexChatHost {
  readonly appServerClientAccess: AppServerClientAccess;
  readonly appServerContext: Readonly<AppServerExecutionContext>;
  readonly settings: ChatPanelSettingsAccess;
  readonly workspace: WorkspacePanels;
  readonly appServerQueries: ChatAppServerQueries;
  readonly threadCatalog: ChatThreadCatalog;
  readonly threadFactCoordinator: ThreadFactCoordinator;
  readonly threadNameMutations: KeyedOperationQueue<string>;
  readonly threadTitleTransport: ThreadTitleTransport;
  readonly threadGoalOperations: ThreadGoalOperationCoordinator;
  readonly runtimeSettingsCommitQueue: KeyedOperationQueue<string>;
}

export interface ChatPanelSettingsAccess {
  referenceActiveNoteOnSend(): boolean;
  attachmentFolder(): string;
  archiveExportEnabled(): boolean;
  archiveExportSettings(): ArchiveExportSettings;
  scrollThreadFromComposerEdges(): boolean;
  sendShortcut(): SendShortcut;
  showToolbar(): boolean;
}

export interface WorkspacePanels {
  openThreadInNewView(threadId: string): Promise<void>;
  openThreadInAvailableView(threadId: string): Promise<void>;
  openThreadFromPanel(threadId: string, originViewId: string, originSwitchable: boolean): Promise<void>;
  focusThreadInOpenView(threadId: string): Promise<boolean>;
  threadHasPendingOrRunningPanel(threadId: string): boolean;
  openTurnDiff(state: TurnDiffViewState): Promise<void>;
  notifyPanelActivityChanged(): void;
  openSideChat(sourceThreadId: string, sourceThreadTitle: string | null): Promise<void>;
}

type ChatThreadCatalog = ThreadCatalogPaginatedActiveReader;

interface ChatAppServerQueries {
  appServerMetadataSnapshot(): SharedServerMetadata | null;
  refreshAppServerMetadata(): Promise<void>;
  refreshSkills(): Promise<void>;
  refreshRateLimits(): Promise<void>;
  observeAppServerMetadataResources(
    listener: (resource: SharedServerMetadataResource) => void,
    options?: { emitCurrent?: boolean },
  ): () => void;
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
    isForeground: () => boolean;
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
  refreshSettings(): void;
}

export interface ChatPanelRuntimeSnapshot {
  readonly viewState: Record<string, unknown>;
  readonly composerDraft: string;
  readonly ephemeralSource: { readonly threadId: string; readonly title: string | null } | null;
}

export interface ChatViewRuntimeOwner {
  attachChatView(view: ChatRuntimeView): void;
  detachChatView(view: ChatRuntimeView): void;
}

export interface ChatRuntimeView {
  attachRuntime(host: CodexChatHost): void;
  activateRuntime(): void;
  detachRuntime(): void;
}

export interface ChatWorkspacePanelSnapshot {
  viewId: string;
  threadId: string | null;
  turnBusy: boolean;
  pending: boolean;
  publishedActivity: {
    threadId: string | null;
    turnBusy: boolean;
    pending: boolean;
  };
  hasComposerDraft: boolean;
  connected: boolean;
}

interface ChatWorkspacePanelOperationOptions {
  focus?: boolean;
}

export interface ChatWorkspacePanelSurface {
  openPanelSnapshot(): ChatWorkspacePanelSnapshot;
  openThread(threadId: string, options?: ChatWorkspacePanelOperationOptions): Promise<void>;
  focusThread(threadId?: string | null, options?: ChatWorkspacePanelOperationOptions): Promise<void>;
  hydrateRestoredThread(): Promise<void>;
  focusComposer(options?: { force?: boolean }): void;
  connect(): Promise<void>;
  startNewThread(options?: ChatWorkspacePanelOperationOptions): Promise<void>;
  openSideChat(
    input: { sourceThreadId: string; sourceThreadTitle: string | null },
    options?: ChatWorkspacePanelOperationOptions,
  ): Promise<boolean>;
}

export interface ChatSharedThreadSurface {
  refreshSharedThreads(): Promise<void>;
  applyThreadArchived(threadId: string): void;
  applyThreadRenamed(threadId: string, name: string | null): void;
}

export type ChatPanelHandle = ChatViewLifecycleSurface &
  ChatWorkspacePanelSurface &
  ChatSharedThreadSurface & {
    setComposerText(text: string): void;
  };
