import type { App, Component, EventRef, WorkspaceLeaf } from "obsidian";

import type { AppServerClient } from "../../../app-server/client";
import type { ArchiveExportAdapter } from "../../../domain/threads/export";
import type { RuntimeSnapshot } from "../../../runtime/state";
import type { ChatState, ChatStateStore } from "../chat-state";
import type { CodexChatHost } from "../chat-host";
import type { ChatMessageScrollIntentController } from "../panel/message-scroll-intent-controller";
import type { DisplayDetailSection, DisplayItem } from "../display/types";
import type {
  ChatConnectionWorkTracker,
  ChatResumeWorkTracker,
  ChatViewDeferredTasks,
  ChatViewRenderScheduleOptions,
  RestoredThreadState,
} from "./lifecycle";
import type { ComposerMetaViewModel } from "./model";

export interface ChatPanelContext {
  obsidian: ChatPanelObsidianContext;
  plugin: CodexChatHost;
  state: ChatPanelStateContext;
  client: ChatPanelClientContext;
  lifecycle: ChatPanelLifecycleContext;
  render: ChatPanelRenderContext;
  runtime: ChatPanelRuntimeContext;
  thread: ChatPanelThreadContext;
  liveState: ChatPanelLiveStateContext;
  scroll: ChatPanelScrollContext;
  status: ChatPanelStatusContext;
  composer: ChatPanelComposerContext;
}

interface ChatPanelObsidianContext {
  app: App;
  owner: Component;
  viewId: string;
  registerEvent: (eventRef: EventRef) => void;
  registerPointerDown: (handler: (event: PointerEvent) => void) => void;
  registerActiveLeafChange: (handler: (leaf: WorkspaceLeaf | null) => void) => void;
  isOwnLeaf: (leaf: WorkspaceLeaf | null) => boolean;
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
  ensureConnected: () => Promise<void>;
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
  invalidateResumeWork: () => void;
  scheduleDeferredDiagnostics: () => void;
  clearDeferredDiagnostics: () => void;
  scheduleDeferredRestoredThreadHydration: () => void;
  clearDeferredRestoredThreadHydration: () => void;
  scheduleDeferredAppServerWarmup: () => void;
}

interface ChatPanelRenderContext {
  panelRoot: () => HTMLElement | null;
  renderToolbar: (toolbar: HTMLElement) => void;
  renderGoal: (goal: HTMLElement) => void;
  renderMessages: (parent: HTMLElement) => void;
  renderComposer: (parent: HTMLElement) => void;
  pendingRequestsSignature: () => string;
  activeComposerThreadName: () => string | null;
  composerPlaceholder: () => string;
  composerMetaViewModel: () => ComposerMetaViewModel;
  closeToolbarPanelOnOutsidePointer: (event: PointerEvent) => void;
  now: () => void;
  shellSlots: () => void;
  schedule: (options?: ChatViewRenderScheduleOptions) => void;
}

interface ChatPanelRuntimeContext {
  runtimeSnapshot: () => RuntimeSnapshot;
  collaborationModeLabel: () => string;
  connectionDiagnosticDetails: () => DisplayDetailSection[];
  mcpStatusLines: () => Promise<string[]>;
  modelStatusLines: () => string[];
  effortStatusLines: () => string[];
  statusSummaryLines: () => string[];
}

interface ChatPanelThreadContext {
  ensureRestoredThreadLoaded: () => Promise<boolean>;
  startNewThread: () => Promise<void>;
  selectThread: (threadId: string) => Promise<void>;
  resumeThread: (threadId: string) => Promise<void>;
  refreshThreads: () => Promise<void>;
  refreshSkills: (forceReload?: boolean) => Promise<void>;
  publishAppServerMetadataSnapshot: () => void;
  loadSharedThreadList: () => Promise<void>;
  notifyIdentityChanged: () => void;
  resetTurnPresence: (hadTurns: boolean) => void;
  restorePlaceholder: (restoredThread: RestoredThreadState) => void;
  clearRestoredLifecycle: () => void;
  refreshTabHeader: () => void;
}

interface ChatPanelLiveStateContext {
  refresh: () => void;
  deferRefresh: () => void;
}

interface ChatPanelScrollContext {
  forceBottom: () => void;
  correctAfterLayoutChange: () => void;
  preservePosition: () => void;
  bottomOnFocus: () => void;
}

interface ChatPanelStatusContext {
  set: (status: string) => void;
  addSystemMessage: (text: string) => void;
  addStructuredSystemMessage: (text: string, details: DisplayDetailSection[]) => void;
}

interface ChatPanelComposerContext {
  setText: (text: string) => void;
}
