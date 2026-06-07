import type { App, Component, EventRef, WorkspaceLeaf } from "obsidian";

import type { AppServerClient } from "../../../app-server/client";
import type { ArchiveExportAdapter } from "../../../domain/threads/export";
import type { RuntimeSnapshot } from "../../../runtime/state";
import type { ChatMessageScrollController } from "../controllers/view/message-scroll-controller";
import type { ChatState, ChatStateStore } from "../chat-state";
import type { CodexChatHost } from "../chat-host";
import type { DisplayDetailSection } from "../display/types";
import type { ChatViewControllers } from "./controllers";
import type { ChatViewEffects } from "./effects";
import type { ChatConnectionWorkTracker, ChatResumeWorkTracker, ChatViewDeferredTasks } from "./lifecycle";
import type { ComposerMetaViewModel } from "./model";
import type { ChatViewSlotRenderers } from "./slots/renderers";

export interface ChatViewControllerPorts {
  obsidian: ChatViewObsidianPort;
  plugin: CodexChatHost;
  state: ChatViewStatePort;
  client: ChatViewClientPort;
  lifecycle: ChatViewLifecyclePort;
  render: ChatViewRenderPort;
  runtime: ChatViewRuntimePort;
  thread: ChatViewThreadPort;
  effects: ChatViewEffects;
}

export interface ChatViewObsidianPort {
  app: App;
  owner: Component;
  viewId: string;
  registerEvent: (eventRef: EventRef) => void;
  registerPointerDown: (handler: (event: PointerEvent) => void) => void;
  registerActiveLeafChange: (handler: (leaf: WorkspaceLeaf | null) => void) => void;
  isOwnLeaf: (leaf: WorkspaceLeaf | null) => boolean;
  archiveAdapter: () => ArchiveExportAdapter;
}

export interface ChatViewStatePort {
  stateStore: ChatStateStore;
  getState: () => ChatState;
}

export interface ChatViewClientPort {
  getClient: () => AppServerClient | null;
  setClient: (client: AppServerClient | null) => void;
}

export interface ChatViewLifecyclePort {
  deferredTasks: ChatViewDeferredTasks;
  resumeWork: ChatResumeWorkTracker;
  connectionWork: ChatConnectionWorkTracker;
  messageScroll: ChatMessageScrollController;
  getOpened: () => boolean;
  setOpened: (opened: boolean) => void;
  getClosing: () => boolean;
  setClosing: (closing: boolean) => void;
}

export interface ChatViewRenderPort {
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

export interface ChatViewRuntimePort {
  runtimeSnapshot: () => RuntimeSnapshot;
  collaborationModeLabel: () => string;
  connectionDiagnosticDetails: () => DisplayDetailSection[];
  mcpStatusLines: () => Promise<string[]>;
  modelStatusLines: () => string[];
  effortStatusLines: () => string[];
  statusSummaryLines: () => string[];
}

export interface ChatViewThreadPort {
  ensureRestoredThreadLoaded: () => Promise<boolean>;
  startNewThread: () => Promise<void>;
  selectThread: (threadId: string) => Promise<void>;
  resumeThread: (threadId: string) => Promise<void>;
  refreshThreads: () => Promise<void>;
  refreshSkills: (forceReload?: boolean) => Promise<void>;
  publishAppServerMetadataSnapshot: () => void;
  loadSharedThreadList: () => Promise<void>;
}

export interface ChatViewControllerPortsOptions {
  obsidian: {
    app: ChatViewObsidianPort["app"];
    owner: ChatViewObsidianPort["owner"];
    viewId: string;
    registerEvent: ChatViewObsidianPort["registerEvent"];
    registerPointerDown: ChatViewObsidianPort["registerPointerDown"];
    registerActiveLeafChange: ChatViewObsidianPort["registerActiveLeafChange"];
    isOwnLeaf: ChatViewObsidianPort["isOwnLeaf"];
    archiveAdapter: () => ArchiveExportAdapter;
  };
  plugin: CodexChatHost;
  stateStore: ChatStateStore;
  getState: () => ChatState;
  client: {
    get: () => AppServerClient | null;
    set: (client: AppServerClient | null) => void;
  };
  lifecycle: {
    deferredTasks: ChatViewDeferredTasks;
    resumeWork: ChatResumeWorkTracker;
    connectionWork: ChatConnectionWorkTracker;
    messageScroll: ChatMessageScrollController;
    opened: {
      get: () => boolean;
      set: (opened: boolean) => void;
    };
    closing: {
      get: () => boolean;
      set: (closing: boolean) => void;
    };
  };
  controllers: () => ChatViewControllers;
  slotRenderers: () => ChatViewSlotRenderers;
  panelRoot: () => HTMLElement | null;
  closeToolbarPanelOnOutsidePointer: (event: PointerEvent) => void;
  runtimeSnapshot: () => RuntimeSnapshot;
  collaborationModeLabel: () => string;
  connectionDiagnosticDetails: () => DisplayDetailSection[];
  modelStatusLines: () => string[];
  effortStatusLines: () => string[];
  statusSummaryLines: () => string[];
  ensureRestoredThreadLoaded: () => Promise<boolean>;
  startNewThread: () => Promise<void>;
  loadSharedThreadList: () => Promise<void>;
  effects: ChatViewEffects;
}

export function createChatViewControllerPorts(options: ChatViewControllerPortsOptions): ChatViewControllerPorts {
  return {
    obsidian: options.obsidian,
    plugin: options.plugin,
    state: {
      stateStore: options.stateStore,
      getState: options.getState,
    },
    client: {
      getClient: options.client.get,
      setClient: options.client.set,
    },
    lifecycle: createControllerLifecyclePort(options.lifecycle),
    render: createControllerRenderPort(options),
    runtime: createControllerRuntimePort(options),
    thread: createControllerThreadPort(options),
    effects: options.effects,
  };
}

function createControllerLifecyclePort(options: ChatViewControllerPortsOptions["lifecycle"]): ChatViewLifecyclePort {
  return {
    deferredTasks: options.deferredTasks,
    resumeWork: options.resumeWork,
    connectionWork: options.connectionWork,
    messageScroll: options.messageScroll,
    getOpened: options.opened.get,
    setOpened: options.opened.set,
    getClosing: options.closing.get,
    setClosing: options.closing.set,
  };
}

function createControllerRenderPort(options: ChatViewControllerPortsOptions): ChatViewRenderPort {
  return {
    panelRoot: options.panelRoot,
    renderToolbar: (toolbar) => {
      options.slotRenderers().renderToolbar(toolbar);
    },
    renderGoal: (goal) => {
      options.slotRenderers().renderGoal(goal);
    },
    renderMessages: (parent) => {
      options.slotRenderers().renderMessages(parent);
    },
    renderComposer: (parent) => {
      options.slotRenderers().renderComposer(parent);
    },
    pendingRequestsSignature: () => options.slotRenderers().pendingRequestsSignature(),
    activeComposerThreadName: () => options.slotRenderers().activeComposerThreadName(),
    composerPlaceholder: () => options.slotRenderers().composerPlaceholder(),
    composerMetaViewModel: () => options.slotRenderers().composerMetaViewModel(),
    closeToolbarPanelOnOutsidePointer: options.closeToolbarPanelOnOutsidePointer,
  };
}

function createControllerRuntimePort(options: ChatViewControllerPortsOptions): ChatViewRuntimePort {
  return {
    runtimeSnapshot: options.runtimeSnapshot,
    collaborationModeLabel: options.collaborationModeLabel,
    connectionDiagnosticDetails: options.connectionDiagnosticDetails,
    mcpStatusLines: () => options.controllers().appServer.diagnostics.mcpStatusLines(),
    modelStatusLines: options.modelStatusLines,
    effortStatusLines: options.effortStatusLines,
    statusSummaryLines: options.statusSummaryLines,
  };
}

function createControllerThreadPort(options: ChatViewControllerPortsOptions): ChatViewThreadPort {
  return {
    ensureRestoredThreadLoaded: options.ensureRestoredThreadLoaded,
    startNewThread: options.startNewThread,
    selectThread: (threadId) => options.controllers().thread.selection.selectThread(threadId),
    resumeThread: (threadId) => options.controllers().thread.resume.resumeThread(threadId),
    refreshThreads: () => options.controllers().connection.controller.refreshThreads(),
    refreshSkills: (forceReload) => options.controllers().connection.controller.refreshSkills(forceReload),
    publishAppServerMetadataSnapshot: () => {
      options.controllers().appServer.metadata.publishAppServerMetadataSnapshot();
    },
    loadSharedThreadList: options.loadSharedThreadList,
  };
}
