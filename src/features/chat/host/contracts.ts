import type { App, Component, EventRef } from "obsidian";

import type { AppServerContextConnectionLease } from "../../../app-server/connection/context-connection";
import type { AppServerExecutionContext } from "../../../app-server/connection/execution-context";
import type { ModelMetadata } from "../../../domain/catalog/metadata";
import type { SendShortcut } from "../../../domain/input/send-shortcut";
import type { MetadataResourceDiagnostics } from "../../../domain/server/diagnostics";
import type {
  SharedServerMetadataResourceFor,
  SharedServerMetadataResourceId,
  SharedServerMetadataSnapshotValues,
} from "../../../domain/server/metadata";
import type { KeyedOperationCoordinator } from "../../../shared/runtime/keyed-operation-coordinator";
import type { ThreadCatalogPaginatedActiveReader } from "../../threads/catalog/thread-catalog";
import type { ThreadTitlePort } from "../../threads/workflows/ports";
import type { ThreadAutoTitleWork } from "../../threads/workflows/thread-auto-title-work";
import type { ThreadFactSink } from "../../threads/workflows/thread-facts";
import type { ThreadMutationCommands } from "../../threads/workflows/thread-mutation-commands";
import type { ThreadReplacementPublicationOwner } from "../../threads/workflows/thread-replacement-publication";
import type { TurnDiffViewState } from "../../turn-diff/model";
import type { ComposerRuntimeSnapshot } from "../application/composer/runtime-snapshot";
import type { ThreadGoalCoordinator } from "../application/threads/thread-goal-coordinator";

export interface CodexChatHost {
  readonly appServerConnection: { createLease(): AppServerContextConnectionLease };
  readonly appServerContext: Readonly<AppServerExecutionContext>;
  readonly settings: ChatPanelSettingsAccess;
  readonly workspace: WorkspacePanels;
  readonly appServerQueries: ChatAppServerQueries;
  readonly threadCatalog: ChatThreadCatalog;
  readonly threadFacts: ThreadFactSink;
  readonly threadReplacementPublication: Pick<ThreadReplacementPublicationOwner, "begin">;
  readonly threadMutations: ThreadMutationCommands;
  readonly threadTitlePort: ThreadTitlePort;
  readonly threadAutoTitleWork: Pick<ThreadAutoTitleWork, "submit">;
  readonly threadGoalCoordinator: ThreadGoalCoordinator;
  readonly runtimeSettingsCommitQueue: KeyedOperationCoordinator<string>;
}

export interface ChatPanelSettingsAccess {
  referenceActiveNoteOnSend(): boolean;
  attachmentFolder(): string;
  archiveExportEnabled(): boolean;
  scrollThreadFromComposerEdges(): boolean;
  sendShortcut(): SendShortcut;
  showToolbar(): boolean;
}

export interface WorkspacePanels {
  openThreadInNewView(threadId: string): Promise<void>;
  openThreadInAvailableView(threadId: string): Promise<void>;
  openThreadFromPanel(threadId: string, originViewId: string, originSwitchable: boolean): Promise<void>;
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
}

export interface ChatPanelEnvironment {
  obsidian: {
    app: App;
    owner: Component;
    viewId: string;
    registerEvent: (eventRef: EventRef) => void;
    registerPointerDown: (handler: (event: PointerEvent) => void) => void;
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
  activateThread(threadId?: string, options?: ChatWorkspacePanelOperationOptions): Promise<void>;
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
