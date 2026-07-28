import type { App, Component, EventRef } from "obsidian";

import type { AppServerClientAccess } from "../../../app-server/connection/client-access";
import type { AppServerExecutionContext } from "../../../app-server/connection/execution-context";
import type { ModelMetadata } from "../../../domain/catalog/metadata";
import type { SendShortcut } from "../../../domain/input/send-shortcut";
import type { MetadataResourceDiagnostics } from "../../../domain/server/diagnostics";
import type {
  SharedServerMetadataResourceFor,
  SharedServerMetadataResourceId,
  SharedServerMetadataSnapshotValues,
} from "../../../domain/server/metadata";
import type { KeyedOperationQueue } from "../../../shared/runtime/keyed-operation-queue";
import type { ObservedResultListener } from "../../../shared/runtime/observed-result";
import type { ThreadCatalogPaginatedActiveReader } from "../../threads/catalog/thread-catalog";
import type { ArchiveExportDestination, ArchiveExportSettings } from "../../threads/workflows/archive-export";
import type { ThreadTitlePort } from "../../threads/workflows/ports";
import type { ThreadAutoTitleWork } from "../../threads/workflows/thread-auto-title-work";
import type { ThreadFactSink } from "../../threads/workflows/thread-facts";
import type { TurnDiffViewState } from "../../turn-diff/model";
import type { ComposerRuntimeSnapshot } from "../application/composer/runtime-snapshot";
import type { ThreadGoalCoordinator } from "../application/threads/thread-goal-coordinator";

export interface CodexChatHost {
  readonly appServerClientAccess: AppServerClientAccess;
  readonly appServerContext: Readonly<AppServerExecutionContext>;
  readonly settings: ChatPanelSettingsAccess;
  readonly workspace: WorkspacePanels;
  readonly appServerQueries: ChatAppServerQueries;
  readonly threadCatalog: ChatThreadCatalog;
  readonly threadFacts: ThreadFactSink;
  readonly threadNameMutations: KeyedOperationQueue<string>;
  readonly threadTitlePort: ThreadTitlePort;
  readonly threadAutoTitleWork: Pick<ThreadAutoTitleWork, "submit">;
  readonly threadGoalCoordinator: ThreadGoalCoordinator;
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
  threadPanelIsBusy(threadId: string): boolean;
  openTurnDiff(state: TurnDiffViewState): Promise<void>;
  notifyPanelActivityChanged(): void;
  openSideChat(sourceThreadId: string, sourceThreadTitle: string | null, initialMessage?: string): Promise<void>;
}

type ChatThreadCatalog = ThreadCatalogPaginatedActiveReader;

interface ChatAppServerQueries {
  metadataSnapshot<Id extends SharedServerMetadataResourceId>(id: Id): SharedServerMetadataSnapshotValues[Id];
  metadataDiagnosticsSnapshot(): MetadataResourceDiagnostics;
  refreshAppServerMetadata(): Promise<void>;
  refreshSkills(): Promise<void>;
  refreshRateLimits(): Promise<void>;
  observeMetadataResource<Id extends SharedServerMetadataResourceId>(
    id: Id,
    listener: (resource: SharedServerMetadataResourceFor<Id>) => void,
    options?: { emitCurrent?: boolean },
  ): () => void;
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
  readonly composer: ComposerRuntimeSnapshot;
  readonly ephemeralSource: { readonly threadId: string; readonly title: string | null } | null;
}

export interface ChatViewRuntimeOwner {
  attachChatView(view: ChatRuntimeView): void;
}

export interface ChatRuntimeView {
  attachRuntime(host: CodexChatHost): void;
  detachRuntime(): void;
}

export interface ChatWorkspacePanelSnapshot {
  viewId: string;
  threadId: string | null;
  turnBusy: boolean;
  pending: boolean;
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
    input: { sourceThreadId: string; sourceThreadTitle: string | null; initialMessage?: string },
    options?: ChatWorkspacePanelOperationOptions,
  ): Promise<boolean>;
}

export interface ChatSharedThreadSurface {
  refreshSharedThreads(): Promise<void>;
  applyThreadUnavailable(threadId: string): void;
  applyThreadRenamed(threadId: string, name: string | null): void;
}

export type ChatPanelHandle = ChatViewLifecycleSurface &
  ChatWorkspacePanelSurface &
  ChatSharedThreadSurface & {
    setComposerText(text: string): void;
  };
