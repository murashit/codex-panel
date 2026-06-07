import type { App, Component, EventRef, WorkspaceLeaf } from "obsidian";

import type { AppServerClient } from "../../../app-server/client";
import type { ArchiveExportAdapter } from "../../../domain/threads/export";
import type { RuntimeSnapshot } from "../../../runtime/state";
import type { ChatState, ChatStateStore } from "../chat-state";
import type { CodexChatHost } from "../chat-host";
import type { ChatMessageScrollIntentController } from "../controllers/view/message-scroll-intent-controller";
import type { DisplayDetailSection } from "../display/types";
import type { ChatViewEffects } from "./effects";
import type { ChatConnectionWorkTracker, ChatResumeWorkTracker, ChatViewDeferredTasks } from "./lifecycle";
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
  effects: ChatViewEffects;
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
}

interface ChatPanelClientContext {
  getClient: () => AppServerClient | null;
  setClient: (client: AppServerClient | null) => void;
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
}
