import type { App, Component, EventRef } from "obsidian";

import type { AppServerClient } from "../../app-server/connection/client";
import type { ArchiveExportAdapter } from "../thread-export/archive-markdown";
import type { ChatConnectionPhase, ChatStateStore } from "./state/reducer";
import type { ChatMessageScrollIntentState } from "./ui/message-stream/scroll-intent-state";
import type { DisplayDetailSection, DisplayItem } from "./display/types";
import type { ChatConnectionWorkTracker, ChatResumeWorkTracker, ChatViewDeferredTasks } from "./lifecycle";
import type { ComposerMetaViewModel } from "./ui/composer";
import type { CodexChatHost } from "./chat-host";
import type { ChatPanelShellParts } from "./ui/shell";
import type { ChatPanelComposerShellState } from "./ui/shell-state";

export interface ChatControllerPorts {
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
  shellParts: () => ChatPanelShellParts;
  closeToolbarPanelOnOutsidePointer: (event: PointerEvent) => void;
}

interface ChatPanelSurfaceContext {
  pendingRequestsSignature: () => string;
  composerPlaceholder: (state: ChatPanelComposerShellState) => string;
  composerMetaViewModel: (state: ChatPanelComposerShellState) => ComposerMetaViewModel;
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
  set: (statusText: string, phase?: ChatConnectionPhase) => void;
}
