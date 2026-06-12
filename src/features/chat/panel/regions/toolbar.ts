import type { ComponentChild as UiNode } from "preact";
import { h } from "preact";
import { useEffect, useState } from "preact/hooks";

import type { Thread } from "../../../../domain/threads/model";
import { getThreadTitle } from "../../../../domain/threads/model";
import type { ChatThreadActions } from "../../threads/action-context";
import { runtimeConfigSections, rateLimitSummary } from "../../display/status/runtime";
import { connectionDiagnosticSections } from "../../display/status/diagnostics";
import type { RuntimeSnapshot } from "../../runtime/snapshot";
import type { ChatAction, ChatState, ChatStateStore } from "../../state/reducer";
import { useChatPanelShellState, type ChatPanelShellState } from "../../ui/shell";
import { toolbarNode, type ToolbarThreadRow, type ToolbarViewModel } from "../../ui/toolbar";
import type { ChatPanelToolbarPorts } from "./ports";

export interface ToolbarViewModelInput {
  state: ChatState;
  snapshot: RuntimeSnapshot;
  connected: boolean;
  turnBusy: boolean;
  vaultPath: string;
  configuredCommand: string;
  archiveConfirmThreadId: string | null;
  archiveExportEnabled: boolean;
  renameState: (threadId: string) => ToolbarThreadRow["rename"];
}

export interface ConnectionDiagnosticsModelInput {
  state: ChatState;
  connected: boolean;
  configuredCommand: string;
}

export interface ToolbarPanelActionsHost {
  stateStore: ChatStateStore;
  threadActions: ChatThreadActions;
  archiveConfirm: ToolbarArchiveConfirmState;
  scheduleRender: () => void;
}

export interface ToolbarArchiveConfirmState {
  get: () => string | null;
  set: (threadId: string | null) => void;
  subscribe: (listener: () => void) => () => void;
}

export interface ToolbarPanelActions {
  archiveConfirmId(): string | null;
  onArchiveConfirmChange(listener: () => void): () => void;
  toggleHistory(): void;
  toggleChatActions(): void;
  closeToolbarPanels(): void;
  toggleStatus(): void;
  closeForThreadSelection(): void;
  startArchive(threadId: string): void;
  archiveThread(threadId: string, saveMarkdown: boolean): Promise<void>;
  closeOnOutsidePointer(context: ToolbarOutsidePointerContext): void;
}

interface ToolbarOutsidePointerContext {
  target: EventTarget | null;
  viewWindow: ToolbarDomWindow | null;
  contains: (element: Element) => boolean;
  renameEditing: boolean;
}

type ToolbarDomWindow = Window & { Element: typeof Element };

function chatPanelToolbarViewModel(ports: ChatPanelToolbarPorts, shellState: ChatPanelShellState) {
  const latestState = shellState.latestState();
  return toolbarViewModel({
    state: {
      ...latestState,
      connection: shellState.connection.value,
      threadList: shellState.threadList.value,
      activeThread: shellState.activeThread.value,
      runtime: shellState.runtime.value,
      turn: shellState.turn.value,
      ui: shellState.ui.value,
    },
    snapshot: ports.runtime.snapshot(),
    connected: ports.state.connected(),
    turnBusy: ports.state.turnBusy(),
    vaultPath: ports.settings.vaultPath(),
    configuredCommand: ports.settings.configuredCommand(),
    archiveConfirmThreadId: ports.view.toolbar.archiveConfirmId(),
    archiveExportEnabled: ports.settings.archiveExportEnabled(),
    renameState: (threadId) => ports.view.toolbar.renameState(threadId),
  });
}

export function chatPanelToolbarRegionNode(ports: ChatPanelToolbarPorts): UiNode {
  return h(ToolbarRegion, { ports });
}

function ToolbarRegion({ ports }: { ports: ChatPanelToolbarPorts }): UiNode {
  const shellState = useChatPanelShellState();
  useToolbarArchiveConfirmSubscription(ports);
  useToolbarRenameSubscription(ports);
  void shellState.renderVersion.value;
  return toolbarNode(chatPanelToolbarViewModel(ports, shellState), ports.actions.toolbar);
}

function useToolbarArchiveConfirmSubscription(ports: ChatPanelToolbarPorts): void {
  const [, setVersion] = useState(0);
  useEffect(
    () =>
      ports.view.toolbar.archiveConfirmSubscribe(() => {
        setVersion((version) => version + 1);
      }),
    [ports],
  );
}

function useToolbarRenameSubscription(ports: ChatPanelToolbarPorts): void {
  const [, setVersion] = useState(0);
  useEffect(
    () =>
      ports.view.toolbar.renameSubscribe(() => {
        setVersion((version) => version + 1);
      }),
    [ports],
  );
}

export function toolbarViewModel(input: ToolbarViewModelInput): ToolbarViewModel {
  const { state, snapshot } = input;
  const limit = rateLimitSummary(snapshot, Date.now());
  const historyOpen = state.ui.toolbarPanel === "history";
  const chatActionsOpen = state.ui.toolbarPanel === "chat-actions";
  const statusPanelOpen = state.ui.toolbarPanel === "status-panel";
  return {
    newChatDisabled: input.turnBusy,
    chatActionsOpen,
    historyOpen,
    statusPanelOpen,
    rateLimit: limit,
    configSections: runtimeConfigSections(snapshot, input.vaultPath),
    openPanel: historyOpen ? "history" : chatActionsOpen ? "chat-actions" : statusPanelOpen ? "status" : null,
    threads: toolbarThreadRows({
      threads: state.threadList.listedThreads,
      activeThreadId: state.activeThread.id,
      turnBusy: input.turnBusy,
      archiveConfirmThreadId: input.archiveConfirmThreadId,
      archiveExportEnabled: input.archiveExportEnabled,
      renameState: input.renameState,
    }),
    connectLabel: input.connected ? "Reconnect" : "Connect",
    diagnostics: connectionDiagnosticsModel({
      state,
      connected: input.connected,
      configuredCommand: input.configuredCommand,
    }),
  };
}

function toolbarThreadRows(input: {
  threads: readonly Thread[];
  activeThreadId: string | null;
  turnBusy: boolean;
  archiveConfirmThreadId: string | null;
  archiveExportEnabled: boolean;
  renameState: (threadId: string) => ToolbarThreadRow["rename"];
}): ToolbarThreadRow[] {
  return input.threads.map((thread) => {
    const threadId = thread.id;
    return {
      title: getThreadTitle(thread),
      threadId,
      selected: threadId === input.activeThreadId,
      disabled: input.turnBusy && threadId !== input.activeThreadId,
      canArchive: true,
      archiveConfirm: {
        active: input.archiveConfirmThreadId === threadId,
        defaultSaveMarkdown: input.archiveExportEnabled,
      },
      rename: input.renameState(threadId),
    };
  });
}

export function connectionDiagnosticsModel(input: ConnectionDiagnosticsModelInput): ReturnType<typeof connectionDiagnosticSections> {
  return connectionDiagnosticSections({
    connected: input.connected,
    configuredCommand: input.configuredCommand,
    initializeResponse: input.state.connection.initializeResponse,
    diagnostics: input.state.connection.serverDiagnostics,
  });
}

export function createToolbarPanelActions(host: ToolbarPanelActionsHost): ToolbarPanelActions {
  const state = (): ChatState => host.stateStore.getState();
  const dispatch = (action: ChatAction): void => {
    host.stateStore.dispatch(action);
  };
  const hasOpenPanel = (): boolean => state().ui.toolbarPanel !== null;
  const close = (): void => {
    if (!hasOpenPanel()) return;

    dispatch({ type: "ui/panel-set", panel: null });
    host.archiveConfirm.set(null);
    host.scheduleRender();
  };

  return {
    archiveConfirmId(): string | null {
      return host.archiveConfirm.get();
    },

    onArchiveConfirmChange(listener: () => void): () => void {
      return host.archiveConfirm.subscribe(listener);
    },

    toggleHistory(): void {
      dispatch({ type: "ui/panel-set", panel: "history", toggle: true });
      host.scheduleRender();
    },

    toggleChatActions(): void {
      dispatch({ type: "ui/panel-set", panel: "chat-actions", toggle: true });
      host.scheduleRender();
    },

    closeToolbarPanels(): void {
      close();
    },

    toggleStatus(): void {
      dispatch({ type: "ui/panel-set", panel: "status-panel", toggle: true });
      host.scheduleRender();
    },

    closeForThreadSelection(): void {
      host.archiveConfirm.set(null);
    },

    startArchive(threadId: string): void {
      host.archiveConfirm.set(threadId);
    },

    async archiveThread(threadId: string, saveMarkdown: boolean): Promise<void> {
      if (host.archiveConfirm.get() === threadId) host.archiveConfirm.set(null);
      await host.threadActions.archiveThread(threadId, saveMarkdown);
      host.scheduleRender();
    },

    closeOnOutsidePointer(context: ToolbarOutsidePointerContext): void {
      if (!hasOpenPanel()) return;

      const target = context.target;
      if (isToolbarElement(target, context.viewWindow)) {
        const insideToolbarPanel = target.closest(".codex-panel__toolbar-primary, .codex-panel__toolbar-panel");
        if (insideToolbarPanel && context.contains(insideToolbarPanel)) {
          if (host.archiveConfirm.get() && !target.closest(".codex-panel__archive-confirm")) {
            host.archiveConfirm.set(null);
          }
          return;
        }
      }

      if (host.archiveConfirm.get()) {
        host.archiveConfirm.set(null);
      }

      if (context.renameEditing) return;

      close();
    },
  };
}

function isToolbarElement(target: EventTarget | null, viewWindow: ToolbarDomWindow | null): target is Element {
  return Boolean(viewWindow && target instanceof viewWindow.Element);
}

export function createToolbarArchiveConfirmState(): ToolbarArchiveConfirmState {
  let threadId: string | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => threadId,
    set: (nextThreadId) => {
      if (threadId === nextThreadId) return;
      threadId = nextThreadId;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
