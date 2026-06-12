import type { App, Component, EventRef } from "obsidian";
import type { ComponentChild as UiNode } from "preact";

import type { AppServerClient } from "../../../app-server/client";
import type { SharedAppServerMetadata } from "../../../app-server/shared-cache-state";
import type { ArchiveExportAdapter } from "../../../domain/threads/export";
import type { Thread } from "../../../domain/threads/model";
import type { CodexPanelSettings } from "../../../settings/model";
import type { RuntimeSnapshot } from "../runtime/model";
import type { ChatState, ChatStateStore } from "../state/reducer";
import type { ChatTurnDiffViewState } from "../turn-diff/model";
import type { ChatMessageScrollIntentController } from "../panel/message-scroll-intent-controller";
import type { DisplayDetailSection, DisplayItem } from "../display/types";
import type { ChatConnectionWorkTracker, ChatResumeWorkTracker, ChatViewDeferredTasks } from "./lifecycle";
import type { ComposerMetaViewModel } from "./view-model/composer";

export interface ChatControllerCompositionPorts {
  obsidian: ChatPanelObsidianContext;
  plugin: ChatControllerHostContext;
  state: ChatPanelStateContext;
  client: ChatPanelClientContext;
  lifecycle: ChatPanelLifecycleContext;
  render: ChatPanelRenderContext;
  messages: ChatPanelMessageContext;
  composerView: ChatPanelComposerContext;
  runtime: ChatPanelRuntimeContext;
  thread: ChatThreadContext;
  liveState: ChatPanelLiveStateContext;
  scroll: ChatPanelScrollContext;
  status: ChatPanelStatusContext;
}

interface ChatControllerHostContext {
  settings: CodexPanelSettings;
  vaultPath: string;
  openThreadInNewView: (threadId: string) => Promise<unknown>;
  focusThreadInOpenView: (threadId: string) => Promise<boolean>;
  openTurnDiff: (state: ChatTurnDiffViewState) => Promise<void>;
  notifyThreadArchived: (threadId: string) => void;
  notifyThreadRenamed: (threadId: string, name: string | null) => void;
  refreshThreadsViewLiveState: () => void;
  refreshSharedThreadListFromOpenSurface: () => void;
  applyThreadListSnapshot: (threads: readonly Thread[]) => void;
  publishAppServerMetadata: (metadata: SharedAppServerMetadata) => void;
  publishAppServerIdentity: (userAgent: string | null) => void;
  cachedThreadList: () => readonly Thread[] | null;
  cachedAppServerMetadata: () => SharedAppServerMetadata | null;
}

interface ChatPanelObsidianContext {
  app: App;
  owner: Component;
  viewId: string;
  registerEvent: (eventRef: EventRef) => void;
  registerPointerDown: (handler: (event: PointerEvent) => void) => void;
  archiveAdapter: () => ArchiveExportAdapter;
}

interface ChatPanelStateContext {
  stateStore: ChatStateStore;
  getState: () => ChatState;
  systemItem: (text: string) => DisplayItem;
  structuredSystemItem: (text: string, details: DisplayDetailSection[]) => DisplayItem;
}

interface ChatPanelClientContext {
  getClient: () => AppServerClient | null;
  setClient: (client: AppServerClient | null) => void;
  clear: () => void;
}

interface ChatPanelLifecycleContext {
  deferredTasks: ChatViewDeferredTasks;
  resumeWork: ChatResumeWorkTracker;
  connectionWork: ChatConnectionWorkTracker;
  messageScrollIntent: ChatMessageScrollIntentController;
  getOpened: () => boolean;
  setOpened: (opened: boolean) => void;
  getClosing: () => boolean;
  setClosing: (closing: boolean) => void;
  invalidateConnectionWork: () => void;
  scheduleDeferredDiagnostics: () => void;
  clearDeferredDiagnostics: () => void;
  scheduleDeferredRestoredThreadHydration: () => void;
  clearDeferredRestoredThreadHydration: () => void;
  scheduleDeferredAppServerWarmup: () => void;
}

interface ChatPanelRenderContext {
  panelRoot: () => HTMLElement | null;
  toolbarNode: () => UiNode;
  goalNode: () => UiNode;
  messagesNode: () => UiNode;
  composerNode: () => UiNode;
  closeToolbarPanelOnOutsidePointer: (event: PointerEvent) => void;
  schedule: () => void;
}

interface ChatPanelMessageContext {
  pendingRequestsSignature: () => string;
}

interface ChatPanelComposerContext {
  composerPlaceholder: () => string;
  composerMetaViewModel: () => ComposerMetaViewModel;
}

interface ChatPanelRuntimeContext {
  runtimeSnapshotForState: (state: ChatState) => RuntimeSnapshot;
  collaborationModeLabel: () => string;
  connectionDiagnosticDetails: () => DisplayDetailSection[];
  modelStatusLines: () => string[];
  effortStatusLines: () => string[];
  statusSummaryLines: () => string[];
}

interface ChatThreadContext {
  ensureRestoredThreadLoaded: () => Promise<boolean>;
  startNewThread: () => Promise<void>;
  loadSharedThreadList: () => Promise<void>;
  notifyIdentityChanged: () => void;
  refreshTabHeader: () => void;
}

interface ChatPanelLiveStateContext {
  refresh: () => void;
  deferRefresh: () => void;
}

interface ChatPanelScrollContext {
  forceBottom: () => void;
  followBottom: () => void;
  preservePosition: () => void;
}

interface ChatPanelStatusContext {
  set: (status: string) => void;
}
