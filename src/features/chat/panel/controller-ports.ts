import type { App, Component, EventRef, WorkspaceLeaf } from "obsidian";

import type { AppServerClient } from "../../../app-server/client";
import type { ArchiveExportAdapter } from "../../../domain/threads/export";
import type { RuntimeSnapshot } from "../runtime/effective-settings";
import type { ChatState, ChatStateStore } from "../chat-state";
import type { CodexChatHost } from "../chat-host";
import type { ChatMessageScrollIntentController } from "../panel/message-scroll-intent-controller";
import type { DisplayDetailSection, DisplayItem } from "../display/types";
import type { ChatConnectionWorkTracker, ChatResumeWorkTracker, ChatViewDeferredTasks, ChatViewRenderScheduleOptions } from "./lifecycle";
import type { ComposerMetaViewModel } from "./model";

export interface ChatControllerCompositionPorts {
  obsidian: ChatPanelObsidianContext;
  plugin: CodexChatHost;
  state: ChatPanelStateContext;
  client: ChatPanelClientContext;
  lifecycle: ChatPanelLifecycleContext;
  render: ChatPanelRenderContext;
  runtime: ChatPanelRuntimeContext;
  thread: ChatThreadContext;
  liveState: ChatPanelLiveStateContext;
  scroll: ChatPanelScrollContext;
  status: ChatPanelStatusContext;
}

interface ChatPanelObsidianContext {
  app: App;
  owner: Component;
  viewId: string;
  registerEvent: (eventRef: EventRef) => void;
  registerPointerDown: (handler: (event: PointerEvent) => void) => void;
  registerActiveLeafChange: (handler: (leaf: WorkspaceLeaf | null) => void) => void;
  handleActiveLeafChange: (leaf: WorkspaceLeaf | null) => void;
  archiveAdapter: () => ArchiveExportAdapter;
}

interface ChatPanelStateContext {
  stateStore: ChatStateStore;
  getState: () => ChatState;
  systemItem: (text: string) => DisplayItem;
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
  pendingRequestsSignature: () => string;
  activeComposerThreadName: () => string | null;
  composerPlaceholder: () => string;
  composerMetaViewModel: () => ComposerMetaViewModel;
  closeToolbarPanelOnOutsidePointer: (event: PointerEvent) => void;
  schedule: (options?: ChatViewRenderScheduleOptions) => void;
}

interface ChatPanelRuntimeContext {
  runtimeSnapshot: () => RuntimeSnapshot;
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
  preservePosition: () => void;
}

interface ChatPanelStatusContext {
  set: (status: string) => void;
}
