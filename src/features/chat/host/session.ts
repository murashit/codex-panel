import { Notice, type App, type Component, type EventRef } from "obsidian";

import { ConnectionManager, type ConnectionManagerHandlers } from "../../../app-server/connection/connection-manager";
import type { AppServerClient } from "../../../app-server/connection/client";
import type { ModelMetadata } from "../../../domain/catalog/metadata";
import type { Thread } from "../../../domain/threads/model";
import { getThreadTitle } from "../../../domain/threads/model";
import type { SharedServerMetadata } from "../../../domain/server/metadata";
import type { OpenCodexPanelSnapshot } from "../../../workspace/open-panel-snapshot";
import type { ArchiveExportAdapter } from "../../thread-export/archive-markdown";
import type { CodexChatHost } from "../application/chat-host";
import { scheduleAppServerWarmup } from "../application/connection/app-server-warmup";
import { ChatConnectionController } from "../application/connection/connection-controller";
import { createChatReconnectActions } from "../application/connection/reconnect-actions";
import { createChatServerDiagnosticsActions, type ChatServerDiagnosticsActions } from "../app-server/actions/diagnostics";
import { createChatServerMetadataActions, type ChatServerMetadataActions } from "../app-server/actions/metadata";
import { createChatServerThreadActions, type ChatServerThreadActions } from "../app-server/actions/threads";
import type { ChatComposerController } from "../ui/composer-controller";
import { createConversationParts } from "./conversation";
import type { ComposerSubmitActions } from "../application/conversation/composer-submit-actions";
import { codexPanelDisplayTitle } from "../application/threads/title-display";
import type { MessageStreamItem, MessageStreamNoticeSection } from "../domain/message-stream/items";
import { createStructuredSystemItem, createSystemItem } from "../domain/message-stream/factories/system-items";
import {
  effortStatusLines as buildEffortStatusLines,
  modelStatusLines as buildModelStatusLines,
  statusSummaryLines as buildStatusSummaryLines,
} from "../presentation/runtime/status";
import { createChatViewDeferredTasks } from "./lifecycle";
import {
  ChatConnectionWorkTracker,
  ChatResumeWorkTracker,
  type ChatViewDeferredTasks,
  type RestoredThreadState,
} from "../application/lifecycle";
import { applyChatViewState } from "../panel/view-state";
import { closeChatView, openChatView, type ChatViewLifecycleHost } from "../panel/view-lifecycle";
import { createToolbarPanelActions, type ToolbarPanelActions } from "../panel/toolbar-actions";
import { connectionDiagnosticsModel } from "../panel/surface/toolbar";
import { openPanelTurnLifecycle } from "../panel/snapshot";
import { ChatInboundController } from "../app-server/inbound/controller";
import { rejectServerRequest, respondToServerRequest } from "../app-server/requests/responder";
import { collaborationModeLabel as formatCollaborationModeLabel } from "../presentation/runtime/messages";
import { createChatRuntimeSettingsActions } from "../application/runtime/settings-actions";
import { runtimeSnapshotForChatState, type RuntimeSnapshot } from "../application/runtime/snapshot";
import { chatPanelComposerProjection } from "../panel/surface/composer";
import { createChatMessageScrollIntentState, type ChatMessageScrollIntentState } from "../ui/message-stream/scroll-intent-state";
import { renderChatPanelShell } from "../ui/shell";
import {
  chatTurnBusy,
  createChatStateStore,
  type ChatAction,
  type ChatConnectionPhase,
  type ChatState,
  type ChatStateStore,
} from "../application/state/reducer";
import type { GoalActions } from "../application/threads/goal-actions";
import type { AutoTitleController } from "../application/threads/auto-title-controller";
import type { HistoryController } from "../application/threads/history-controller";
import type { IdentitySync } from "../application/threads/identity-sync";
import type { ThreadRenameEditorController } from "../application/threads/rename-editor-controller";
import type { RestorationController } from "../application/threads/restoration-controller";
import type { ResumeController } from "../application/threads/resume-controller";
import type { SelectionActions } from "../application/threads/selection-actions";
import { createThreadParts, createThreadSelectionActions } from "../application/threads/composition";
import type { MessageStreamPresenter } from "../panel/surface/message-stream-presenter";
import { pendingRequestsSignature } from "../domain/pending-requests/signatures";
import { createChatPanelSurface } from "../panel/surface/create-surface";
import type { ChatPanelSurface } from "../panel/surface/model";

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

interface ChatPanelSessionParts {
  connection: {
    manager: ConnectionManager;
    controller: ChatConnectionController;
  };
  serverActions: {
    threads: ChatServerThreadActions;
    metadata: ChatServerMetadataActions;
    diagnostics: ChatServerDiagnosticsActions;
  };
  thread: {
    history: HistoryController;
    resume: ResumeController;
    restoration: RestorationController;
    identity: IdentitySync;
    rename: ThreadRenameEditorController;
  };
  toolbar: {
    panels: ToolbarPanelActions;
  };
  composer: {
    controller: ChatComposerController;
    submission: ComposerSubmitActions;
  };
  render: {
    messageStreamPresenter: MessageStreamPresenter;
  };
  surface: ChatPanelSurface;
}

interface ChatPanelSessionDeferredRef<T> {
  get: () => T;
  set: (value: T) => void;
}

interface ChatPanelSessionPorts {
  currentClient: () => AppServerClient | null;
  ensureConnected: () => Promise<void>;
  refreshThreads: () => Promise<void>;
  refreshSkills: (forceReload?: boolean) => Promise<void>;
  selectThread: (threadId: string) => Promise<void>;
  resumeRestoredThread: (threadId: string) => Promise<void>;
}

interface ChatPanelSessionServerParts {
  connectionController: ChatConnectionController;
  inboundController: ChatInboundController;
  serverActions: ChatPanelSessionParts["serverActions"];
}

interface ChatPanelSessionConnectionEventTargets {
  inbound: ChatInboundController;
  connectionController: ChatConnectionController;
}

interface ChatSessionSideEffects {
  status: {
    set: (statusText: string, phase?: ChatConnectionPhase) => void;
    addSystemMessage: (text: string) => void;
    addStructuredSystemMessage: (text: string, details: MessageStreamNoticeSection[]) => void;
  };
  composer: {
    setText: (text: string) => void;
  };
}

function createChatPanelSessionDeferredRef<T>(name: string): ChatPanelSessionDeferredRef<T> {
  let value: T | null = null;
  return {
    get: () => {
      if (value === null) throw new Error(`${name} was used before chat session parts were initialized.`);
      return value;
    },
    set: (nextValue) => {
      value = nextValue;
    },
  };
}

export class ChatPanelSession {
  private readonly stateStore: ChatStateStore = createChatStateStore();
  private readonly parts: ChatPanelSessionParts;

  private readonly deferredTasks: ChatViewDeferredTasks;
  private readonly connectionWork = new ChatConnectionWorkTracker();
  private readonly resumeWork = new ChatResumeWorkTracker();
  private readonly messageScrollIntent: ChatMessageScrollIntentState = createChatMessageScrollIntentState();
  private opened = false;
  private closing = false;

  constructor(private readonly environment: ChatPanelEnvironment) {
    this.deferredTasks = createChatViewDeferredTasks(() => this.viewWindow());
    this.parts = this.createSessionParts();
  }

  private get state(): ChatState {
    return this.stateStore.getState();
  }

  private dispatch(action: ChatAction): void {
    this.stateStore.dispatch(action);
  }

  displayTitle(): string {
    return codexPanelDisplayTitle(this.state.activeThread.id, this.state.threadList.listedThreads, this.restoredThreadTitle());
  }

  persistedState(): Record<string, unknown> {
    const threadId = this.state.activeThread.id;
    if (!threadId) return { version: 1 };

    const threadTitle = this.restoredThreadTitle() ?? this.activeThreadTitle();
    return {
      version: 1,
      threadId,
      ...(threadTitle ? { threadTitle } : {}),
    };
  }

  applyViewState(state: unknown): void {
    applyChatViewState(
      {
        invalidateResumeWork: () => {
          this.invalidateResumeWork();
        },
        clearRestoredThreadLifecycle: () => {
          this.parts.thread.restoration.clear();
        },
        clearDeferredRestoredThreadHydration: () => {
          this.parts.thread.restoration.clearHydration();
        },
        scheduleDeferredAppServerWarmup: () => {
          this.scheduleWarmup();
        },
        restoreThreadPlaceholder: (restoredThread: RestoredThreadState) => {
          this.parts.thread.restoration.restore(restoredThread);
        },
      },
      state,
    );
  }

  refreshSettings(): void {
    this.mountOrRepairShell();
  }

  refreshSharedThreadList(): Promise<void> {
    return this.loadSharedThreadList();
  }

  applyThreadListSnapshot(threads: readonly Thread[]): void {
    this.parts.serverActions.threads.applyThreadList(threads);
    this.refreshTabHeader();
  }

  applyAppServerMetadataSnapshot(metadata: SharedServerMetadata): void {
    this.parts.serverActions.metadata.applyAppServerMetadata(metadata);
  }

  applyAvailableModelsSnapshot(models: readonly ModelMetadata[]): void {
    this.dispatch({ type: "connection/metadata-applied", availableModels: models });
  }

  openPanelSnapshot(): OpenCodexPanelSnapshot {
    return {
      viewId: this.environment.obsidian.viewId,
      threadId: this.closing ? null : this.state.activeThread.id,
      lastFocused: false,
      turnLifecycle: openPanelTurnLifecycle(this.state.turn.lifecycle),
      pendingApprovals: this.state.requests.approvals.length,
      pendingUserInputs: this.state.requests.pendingUserInputs.length,
      hasComposerDraft: this.state.composer.draft.trim().length > 0,
      connected: this.parts.connection.manager.isConnected(),
    };
  }

  async openThread(threadId: string): Promise<void> {
    await this.parts.thread.resume.resumeThread(threadId);
    this.focusComposer();
  }

  async focusThread(threadId: string | null = null): Promise<void> {
    if (threadId && this.parts.thread.restoration.isPending(threadId)) {
      await this.parts.thread.restoration.ensureLoaded();
    }
    this.focusComposer();
  }

  focusComposer(): void {
    this.parts.composer.controller.focus();
  }

  notifyThreadArchived(threadId: string): void {
    this.parts.thread.identity.notifyThreadArchived(threadId);
  }

  notifyThreadRenamed(threadId: string, name: string | null): void {
    this.parts.thread.identity.notifyThreadRenamed(threadId, name);
  }

  open(): void {
    openChatView(this.lifecycleHost());
  }

  close(): void {
    closeChatView(this.lifecycleHost());
  }

  setComposerText(text: string): void {
    this.parts.composer.controller.setDraft(text, { focus: true });
  }

  async connect(): Promise<void> {
    await this.parts.connection.controller.ensureConnected();
  }

  async startNewThread(): Promise<void> {
    if (chatTurnBusy(this.state)) return;

    this.parts.thread.identity.clearActiveThreadContext();
    this.dispatch({ type: "ui/panel-set", panel: null });
    this.dispatch({ type: "connection/status-set", statusText: "New chat." });
    this.focusComposer();
  }

  private createSessionParts(): ChatPanelSessionParts {
    const connectionHandlers = this.createConnectionHandlers();
    const connection = new ConnectionManager(
      () => this.environment.plugin.settings.codexPath,
      this.environment.plugin.vaultPath,
      connectionHandlers.handlers,
    );
    const connectionControllerRef = createChatPanelSessionDeferredRef<ChatConnectionController>("chat connection controller");
    const resumeRef = createChatPanelSessionDeferredRef<ResumeController>("chat thread resume controller");
    const restorationRef = createChatPanelSessionDeferredRef<RestorationController>("chat thread restoration controller");
    const selectionRef = createChatPanelSessionDeferredRef<SelectionActions>("chat thread selection actions");
    const composerControllerRef = createChatPanelSessionDeferredRef<ChatComposerController>("chat composer controller");
    const sideEffects = this.createSideEffects({
      composerController: composerControllerRef.get,
    });
    const sessionPorts: ChatPanelSessionPorts = {
      currentClient: () => connection.currentClient(),
      ensureConnected: () => connectionControllerRef.get().ensureConnected(),
      refreshThreads: () => connectionControllerRef.get().refreshThreads(),
      refreshSkills: (forceReload) => connectionControllerRef.get().refreshSkills(forceReload),
      selectThread: (threadId) => selectionRef.get().selectThread(threadId),
      resumeRestoredThread: (threadId) => resumeRef.get().resumeThread(threadId),
    };

    const runtimeSettings = createChatRuntimeSettingsActions({
      stateStore: this.stateStore,
      currentClient: sessionPorts.currentClient,
      runtimeSnapshotForState: runtimeSnapshotForChatState,
      collaborationModeLabel: () => this.collaborationModeLabel(),
      addSystemMessage: sideEffects.status.addSystemMessage,
    });
    const threadParts = createThreadParts(
      {
        obsidian: {
          archiveAdapter: this.environment.obsidian.archiveAdapter,
        },
        plugin: this.environment.plugin,
        state: {
          stateStore: this.stateStore,
        },
        lifecycle: {
          deferredTasks: this.deferredTasks,
          resumeWork: this.resumeWork,
          getOpened: () => this.opened,
          getClosing: () => this.closing,
        },
        client: {
          getClient: sessionPorts.currentClient,
          ensureConnected: sessionPorts.ensureConnected,
        },
        status: sideEffects.status,
        thread: {
          selectThread: sessionPorts.selectThread,
          resumeRestoredThread: sessionPorts.resumeRestoredThread,
          refreshThreads: sessionPorts.refreshThreads,
          notifyIdentityChanged: () => {
            this.notifyActiveThreadIdentityChanged();
          },
          refreshTabHeader: () => {
            this.refreshTabHeader();
          },
        },
        liveState: {
          refresh: () => {
            this.refreshLiveState();
          },
        },
        scroll: {
          preservePosition: () => {
            this.messageScrollIntent.preservePosition();
          },
          forceBottom: () => {
            this.messageScrollIntent.forceBottom();
          },
        },
        composer: sideEffects.composer,
      },
      {
        connection,
      },
    );
    const { history, managementActions: threadActions, goals, identity, restoration, resume, rename, autoTitle } = threadParts;
    resumeRef.set(resume);
    restorationRef.set(restoration);
    const toolbarPanels = createToolbarPanelActions({
      stateStore: this.stateStore,
      threadActions,
    });
    const selection = createThreadSelectionActions(
      {
        plugin: this.environment.plugin,
        state: {
          stateStore: this.stateStore,
        },
        thread: {
          resumeThread: (threadId) => resume.resumeThread(threadId),
        },
        status: sideEffects.status,
      },
      {
        closeForThreadSelection: () => {
          toolbarPanels.closeForThreadSelection();
        },
      },
    );
    selectionRef.set(selection);

    const reconnectActions = createChatReconnectActions({
      stateStore: this.stateStore,
      invalidateConnectionWork: () => {
        this.connectionWork.invalidate();
      },
      invalidateResumeWork: () => {
        this.invalidateResumeWork();
      },
      clearDeferredDiagnostics: () => {
        this.deferredTasks.clearDiagnostics();
      },
      reconnect: () => {
        connection.reconnect();
      },
      setStatus: sideEffects.status.set,
      ensureConnected: sessionPorts.ensureConnected,
      resumeThread: (threadId) => resume.resumeThread(threadId),
      addSystemMessage: sideEffects.status.addSystemMessage,
    });
    const serverParts = this.createServerParts({
      connection,
      sideEffects,
      sessionPorts,
      goals,
      autoTitle,
    });
    const { connectionController, inboundController } = serverParts;
    connectionControllerRef.set(connectionController);
    connectionHandlers.attach({ inbound: inboundController, connectionController });
    const { threads: serverThreads, diagnostics: serverDiagnostics } = serverParts.serverActions;

    const surface = createChatPanelSurface(
      {
        settings: this.environment.plugin.settings,
        vaultPath: this.environment.plugin.vaultPath,
        stateStore: this.stateStore,
        restoredThreadPlaceholder: () => restoration.placeholder(),
        startNewThread: () => this.startNewThread(),
      },
      {
        connection,
        connectionController,
        reconnectActions,
        inboundController,
        serverThreads,
        threadActions,
        toolbarPanels,
        rename,
        selection,
        runtimeSettings,
        goals,
      },
    );
    const conversationParts = createConversationParts(
      {
        obsidian: {
          app: this.environment.obsidian.app,
          owner: this.environment.obsidian.owner,
          viewId: this.environment.obsidian.viewId,
        },
        plugin: this.environment.plugin,
        state: {
          stateStore: this.stateStore,
        },
        lifecycle: {
          messageScrollIntent: this.messageScrollIntent,
        },
        surface: {
          pendingRequestsSignature: () =>
            pendingRequestsSignature(
              this.state.requests.approvals,
              this.state.requests.pendingUserInputs,
              this.state.requests.userInputDrafts,
            ),
          composerProjection: (state) => chatPanelComposerProjection(surface.composer, state),
        },
        runtime: {
          connectionDiagnosticDetails: () => this.connectionDiagnosticDetails(),
          modelStatusLines: () => this.modelStatusLines(),
          effortStatusLines: () => this.effortStatusLines(),
          statusSummaryLines: () => this.statusSummaryLines(),
          mcpStatusLines: () => serverDiagnostics.mcpStatusLines(),
        },
        liveState: {
          refresh: () => {
            this.refreshLiveState();
          },
        },
        client: {
          getClient: sessionPorts.currentClient,
          ensureConnected: sessionPorts.ensureConnected,
        },
        status: sideEffects.status,
        thread: {
          ensureRestoredThreadLoaded: () => restorationRef.get().ensureLoaded(),
          startNewThread: () => this.startNewThread(),
          selectThread: sessionPorts.selectThread,
          notifyIdentityChanged: () => {
            this.notifyActiveThreadIdentityChanged();
          },
          resetTurnPresence: (hadTurns) => {
            autoTitle.resetThreadTurnPresence(hadTurns);
          },
        },
        scroll: {
          forceBottom: () => {
            this.messageScrollIntent.forceBottom();
          },
          followBottom: () => {
            this.messageScrollIntent.followBottom();
          },
        },
      },
      {
        controller: inboundController,
        serverThreads,
        runtimeSettings,
        threadActions,
        reconnectActions,
        goals,
        history,
      },
    );
    const { composerSubmit, messageStreamPresenter } = conversationParts;
    const composerController = conversationParts.composerController;
    composerControllerRef.set(composerController);

    return {
      connection: {
        manager: connection,
        controller: connectionController,
      },
      serverActions: serverParts.serverActions,
      thread: {
        history,
        resume,
        restoration,
        identity,
        rename,
      },
      toolbar: {
        panels: toolbarPanels,
      },
      composer: {
        controller: composerController,
        submission: composerSubmit,
      },
      render: {
        messageStreamPresenter,
      },
      surface,
    };
  }

  private createServerParts({
    connection,
    sideEffects,
    sessionPorts,
    goals,
    autoTitle,
  }: {
    connection: ConnectionManager;
    sideEffects: ChatSessionSideEffects;
    sessionPorts: ChatPanelSessionPorts;
    goals: GoalActions;
    autoTitle: AutoTitleController;
  }): ChatPanelSessionServerParts {
    const serverMetadata = createChatServerMetadataActions({
      stateStore: this.stateStore,
      vaultPath: this.environment.plugin.vaultPath,
      currentClient: sessionPorts.currentClient,
      publishAppServerMetadata: (metadata) => {
        this.environment.plugin.publishAppServerMetadata(metadata);
      },
    });
    const serverDiagnostics = createChatServerDiagnosticsActions({
      stateStore: this.stateStore,
      vaultPath: this.environment.plugin.vaultPath,
      currentClient: sessionPorts.currentClient,
      publishAppServerMetadata: (metadata) => {
        this.environment.plugin.publishAppServerMetadata(metadata);
      },
      serverMetadataSnapshot: () => serverMetadata.serverMetadataSnapshot(),
    });
    const serverThreads = createChatServerThreadActions({
      stateStore: this.stateStore,
      vaultPath: this.environment.plugin.vaultPath,
      currentClient: sessionPorts.currentClient,
      runtimeSnapshotForState: runtimeSnapshotForChatState,
      publishThreadList: (threads) => {
        this.environment.plugin.applyThreadListSnapshot(threads);
      },
      syncThreadGoal: (threadId) => {
        void goals.syncThreadGoal(threadId);
      },
    });
    const serverRequestHost = {
      currentClient: sessionPorts.currentClient,
    };
    const inboundController = new ChatInboundController(this.stateStore, {
      refreshThreads: () => {
        void sessionPorts.refreshThreads();
      },
      refreshRateLimits: () => {
        void serverMetadata.refreshPublishedRateLimits();
      },
      refreshSkills: (forceReload) => void sessionPorts.refreshSkills(forceReload),
      publishAppServerMetadata: () => {
        serverMetadata.publishAppServerMetadataSnapshot();
      },
      maybeNameThread: (threadId, turnId, completedSummary) => {
        autoTitle.maybeAutoTitleThread(threadId, turnId, completedSummary);
      },
      notifyThreadArchived: this.environment.plugin.notifyThreadArchived.bind(this.environment.plugin),
      notifyThreadRenamed: this.environment.plugin.notifyThreadRenamed.bind(this.environment.plugin),
      recordMcpStartupStatus: (name, status, message) => {
        serverDiagnostics.recordMcpStartupStatus(name, status, message);
      },
      respondToServerRequest: (requestId, result) => respondToServerRequest(serverRequestHost, requestId, result),
      rejectServerRequest: (requestId, code, message) => rejectServerRequest(serverRequestHost, requestId, code, message),
    });
    const connectionController = new ChatConnectionController({
      stateStore: this.stateStore,
      connection,
      connectionWork: this.connectionWork,
      metadata: {
        refreshPublishedAppServerMetadata: () => serverMetadata.refreshPublishedAppServerMetadata(),
        refreshPublishedSkills: (forceReload) => serverMetadata.refreshPublishedSkills(forceReload),
      },
      diagnostics: {
        refreshPublishedDiagnosticProbes: () => serverDiagnostics.refreshPublishedDiagnosticProbes(),
      },
      invalidateResumeWork: () => {
        this.invalidateResumeWork();
      },
      loadSharedThreadList: () => this.loadSharedThreadList(),
      scheduleDeferredDiagnostics: () => {
        this.deferredTasks.scheduleDiagnostics(() => {
          void this.refreshDeferredDiagnostics();
        });
      },
      clearDeferredDiagnostics: () => {
        this.deferredTasks.clearDiagnostics();
      },
      refreshTabHeader: () => {
        this.refreshTabHeader();
      },
      resetThreadTurnPresence: (hadTurns) => {
        autoTitle.resetThreadTurnPresence(hadTurns);
      },
      setStatus: sideEffects.status.set,
      addSystemMessage: sideEffects.status.addSystemMessage,
      publishAppServerIdentity: (userAgent) => {
        this.environment.plugin.publishAppServerIdentity(userAgent);
      },
      configuredCommand: () => this.environment.plugin.settings.codexPath,
      refreshLiveState: () => {
        this.refreshLiveState();
      },
      notifyConnectionFailed: () => {
        new Notice("Codex app-server connection failed.");
      },
    });

    return {
      connectionController,
      inboundController,
      serverActions: {
        threads: serverThreads,
        metadata: serverMetadata,
        diagnostics: serverDiagnostics,
      },
    };
  }

  private createConnectionHandlers(): {
    handlers: ConnectionManagerHandlers;
    attach: (targets: ChatPanelSessionConnectionEventTargets) => void;
  } {
    let targets: ChatPanelSessionConnectionEventTargets | null = null;
    const currentTargets = () => {
      if (!targets) throw new Error("Codex app-server connection event received before chat session parts were initialized.");
      return targets;
    };
    return {
      handlers: {
        onNotification: (notification) => {
          currentTargets().inbound.handleNotification(notification);
          this.deferLiveStateRefresh();
        },
        onServerRequest: (request) => {
          currentTargets().inbound.handleServerRequest(request);
          this.deferLiveStateRefresh();
        },
        onLog: (message) => {
          currentTargets().inbound.handleAppServerLog(message);
        },
        onExit: () => {
          currentTargets().connectionController.handleExit();
        },
      },
      attach: (nextTargets) => {
        targets = nextTargets;
      },
    };
  }

  private createSideEffects(refs: { composerController: () => ChatComposerController }): ChatSessionSideEffects {
    return {
      status: {
        set: (statusText, phase) => {
          this.dispatch({ type: "connection/status-set", statusText, ...(phase ? { phase } : {}) });
        },
        addSystemMessage: (text) => {
          this.dispatch({ type: "message-stream/system-item-added", item: this.systemItem(text) });
        },
        addStructuredSystemMessage: (text, details) => {
          this.dispatch({ type: "message-stream/system-item-added", item: this.structuredSystemItem(text, details) });
        },
      },
      composer: {
        setText: (text) => {
          refs.composerController().setDraft(text, { focus: true });
        },
      },
    };
  }

  private lifecycleHost(): ChatViewLifecycleHost {
    return {
      lifecycle: {
        setOpened: (opened) => {
          this.opened = opened;
        },
        setClosing: (closing) => {
          this.closing = closing;
        },
        invalidateConnectionWork: () => {
          this.connectionWork.invalidate();
        },
        invalidateResumeWork: () => {
          this.invalidateResumeWork();
        },
        clearDeferredTasks: () => {
          this.deferredTasks.clearAll();
        },
        scheduleDeferredAppServerWarmup: () => {
          this.scheduleWarmup();
        },
        scheduleDeferredRestoredThreadHydration: () => {
          this.parts.thread.restoration.scheduleHydration();
        },
      },
      events: {
        registerEvent: this.environment.obsidian.registerEvent,
        registerComposerNoteIndexInvalidation: (register) => {
          this.parts.composer.controller.registerNoteIndexInvalidation(register);
        },
        registerPointerDown: this.environment.obsidian.registerPointerDown,
        closeToolbarPanelOnOutsidePointer: (event) => {
          this.closeToolbarPanelOnOutsidePointer(event);
        },
      },
      render: {
        panelRoot: this.environment.view.panelRoot,
        mountOrRepairShell: () => {
          this.mountOrRepairShell();
        },
      },
      sharedState: {
        applyCachedAppServerState: () => {
          const threads = this.environment.plugin.cachedThreadList();
          if (threads) this.parts.serverActions.threads.applyThreadList(threads);
          const metadata = this.environment.plugin.cachedAppServerMetadata();
          if (metadata) this.parts.serverActions.metadata.applyAppServerMetadata(metadata);
        },
      },
      resources: {
        disposeMessages: () => {
          this.parts.render.messageStreamPresenter.dispose();
        },
        disposeComposer: () => {
          this.parts.composer.controller.dispose();
        },
        disconnect: () => {
          this.parts.connection.manager.disconnect();
        },
      },
      liveState: {
        refresh: () => {
          this.refreshLiveState();
        },
        deferRefresh: () => {
          this.deferLiveStateRefresh();
        },
      },
    };
  }

  private mountOrRepairShell(): void {
    const root = this.environment.view.panelRoot();
    if (!root) return;
    renderChatPanelShell(root, {
      stateStore: this.stateStore,
      showToolbar: this.environment.plugin.settings.showToolbar,
      parts: {
        toolbar: this.parts.surface.toolbar,
        goal: this.parts.surface.goal,
        messageStream: this.parts.render.messageStreamPresenter,
        composer: {
          controller: this.parts.composer.controller,
          actions: {
            submit: () => void this.parts.composer.submission.submit(),
          },
        },
      },
    });
  }

  private scheduleWarmup(): void {
    scheduleAppServerWarmup({
      deferredTasks: this.deferredTasks,
      opened: () => this.opened,
      closing: () => this.closing,
      connected: () => this.parts.connection.manager.isConnected(),
      ensureConnected: () => this.parts.connection.controller.ensureConnected(),
    });
  }

  private invalidateResumeWork(): void {
    this.resumeWork.invalidate();
    this.parts.thread.history.invalidate();
  }

  private async loadSharedThreadList(): Promise<void> {
    const threads = await this.environment.plugin.refreshThreadList(() => this.parts.serverActions.threads.loadThreadList());
    this.parts.serverActions.threads.applyThreadList(threads);
  }

  private notifyActiveThreadIdentityChanged(): void {
    this.refreshTabHeader();
    this.environment.obsidian.requestWorkspaceLayoutSave();
  }

  private refreshTabHeader(): void {
    this.environment.view.refreshTabHeader();
  }

  private refreshLiveState(): void {
    this.environment.plugin.refreshThreadsViewLiveState();
  }

  private deferLiveStateRefresh(): void {
    this.viewWindow().setTimeout(() => {
      this.refreshLiveState();
    }, 0);
  }

  private viewWindow(): Window {
    return this.environment.view.viewWindow() ?? window;
  }

  private closeToolbarPanelOnOutsidePointer(event: PointerEvent): void {
    this.parts.toolbar.panels.closeOnOutsidePointer({
      target: event.target,
      viewWindow: this.environment.view.viewWindow() as (Window & { Element: typeof Element }) | null,
      contains: (element) => this.environment.view.containsElement(element),
      renameEditing: this.parts.thread.rename.isEditing(),
    });
  }

  private async refreshDeferredDiagnostics(): Promise<void> {
    if (!this.parts.connection.manager.isConnected()) return;
    await this.parts.serverActions.diagnostics.refreshPublishedDiagnosticProbes({ cachedAppServerMetadata: true });
  }

  private activeThreadTitle(): string | null {
    const threadId = this.state.activeThread.id;
    if (!threadId) return null;
    const thread = this.state.threadList.listedThreads.find((item) => item.id === threadId);
    return thread ? getThreadTitle(thread) : null;
  }

  private restoredThreadTitle(): string | null {
    return this.parts.thread.restoration.title();
  }

  private statusSummaryLines(): string[] {
    return buildStatusSummaryLines({
      activeThreadId: this.state.activeThread.id,
      snapshot: this.runtimeSnapshot(),
      nowMs: Date.now(),
    });
  }

  private modelStatusLines(): string[] {
    return buildModelStatusLines({
      runtimeConfig: this.state.connection.runtimeConfig,
      requestedModel: this.state.runtime.requestedModel,
      snapshot: this.runtimeSnapshot(),
      collaborationModeLabel: this.collaborationModeLabel(),
    });
  }

  private effortStatusLines(): string[] {
    return buildEffortStatusLines({
      runtimeConfig: this.state.connection.runtimeConfig,
      requestedReasoningEffort: this.state.runtime.requestedReasoningEffort,
      snapshot: this.runtimeSnapshot(),
    });
  }

  private connectionDiagnosticDetails(): MessageStreamNoticeSection[] {
    return connectionDiagnosticsModel({
      state: this.state,
      connected: this.parts.connection.manager.isConnected(),
      configuredCommand: this.environment.plugin.settings.codexPath,
    }).map((section) => ({
      title: section.title,
      auditFacts: section.rows.map((row) => ({ key: row.label, value: row.value })),
    }));
  }

  private collaborationModeLabel(): string {
    return formatCollaborationModeLabel(this.state.runtime.selectedCollaborationMode);
  }

  private runtimeSnapshot(): RuntimeSnapshot {
    return runtimeSnapshotForChatState(this.state);
  }

  private systemItem(text: string): MessageStreamItem {
    return createSystemItem(`system-${String(Date.now())}-${Math.random().toString(36).slice(2)}`, text);
  }

  private structuredSystemItem(text: string, details: MessageStreamNoticeSection[]): MessageStreamItem {
    return createStructuredSystemItem(`system-${String(Date.now())}-${Math.random().toString(36).slice(2)}`, text, details);
  }
}
