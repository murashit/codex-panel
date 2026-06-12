import type { App, Component, EventRef } from "obsidian";
import type { ComponentChild as UiNode } from "preact";

import type { AppServerClient } from "../../app-server/connection/client";
import type { ArchiveExportAdapter } from "../thread-export/archive-markdown";
import type { ChatStateStore } from "./state/reducer";
import type { ChatMessageScrollIntentState } from "./ui/message-stream/scroll-intent-state";
import type { DisplayDetailSection, DisplayItem } from "./display/types";
import type { ChatConnectionWorkTracker, ChatResumeWorkTracker, ChatViewDeferredTasks } from "./lifecycle";
import type { ComposerMetaViewModel } from "./ui/composer";
import type { CodexChatHost } from "./chat-host";

export interface ChatControllerCompositionPorts {
  obsidian: ChatPanelObsidianContext;
  plugin: CodexChatHost;
  state: ChatPanelStateContext;
  client: ChatPanelClientContext;
  lifecycle: ChatPanelLifecycleContext;
  render: ChatPanelRenderContext;
  surface: ChatPanelSurfaceContext;
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
  archiveAdapter: () => ArchiveExportAdapter;
}

interface ChatPanelStateContext {
  stateStore: ChatStateStore;
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
  messageScrollIntent: ChatMessageScrollIntentState;
  getOpened: () => boolean;
  setOpened: (opened: boolean) => void;
  getClosing: () => boolean;
  setClosing: (closing: boolean) => void;
  refreshDeferredDiagnostics: () => Promise<void>;
}

interface ChatPanelRenderContext {
  panelRoot: () => HTMLElement | null;
  toolbarNode: () => UiNode;
  goalNode: () => UiNode;
  messageStreamNode: () => UiNode;
  composerNode: () => UiNode;
  closeToolbarPanelOnOutsidePointer: (event: PointerEvent) => void;
  schedule: () => void;
}

interface ChatPanelSurfaceContext {
  pendingRequestsSignature: () => string;
  composerPlaceholder: () => string;
  composerMetaViewModel: () => ComposerMetaViewModel;
}

interface ChatPanelRuntimeContext {
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
