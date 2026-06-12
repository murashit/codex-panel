import type { Thread } from "../../../../domain/threads/model";
import { getThreadTitle } from "../../../../domain/threads/model";
import type { ChatThreadActions } from "../../threads/actions";
import { runtimeConfigSections, rateLimitSummary } from "../../display/status/runtime";
import { connectionDiagnosticSections } from "../../display/status/diagnostics";
import type { RuntimeSnapshot } from "../../runtime/snapshot";
import type { ChatAction, ChatState, ChatStateStore } from "../../state/reducer";
import type { ChatPanelShellState } from "../../ui/shell";
import type { ToolbarThreadRow, ToolbarViewModel } from "../../ui/toolbar";
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

export interface ToolbarPanelControllerHost {
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

export interface ToolbarOutsidePointerContext {
  target: EventTarget | null;
  viewWindow: ToolbarDomWindow | null;
  contains: (element: Element) => boolean;
  renameEditing: boolean;
}

type ToolbarDomWindow = Window & { Element: typeof Element };

export function chatPanelToolbarViewModel(ports: ChatPanelToolbarPorts, shellState: ChatPanelShellState) {
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
    diagnostics: input.state.connection.appServerDiagnostics,
  });
}

export class ToolbarPanelController {
  constructor(private readonly host: ToolbarPanelControllerHost) {}

  private get state(): ChatState {
    return this.host.stateStore.getState();
  }

  private dispatch(action: ChatAction): void {
    this.host.stateStore.dispatch(action);
  }

  archiveConfirmId(): string | null {
    return this.host.archiveConfirm.get();
  }

  onArchiveConfirmChange(listener: () => void): () => void {
    return this.host.archiveConfirm.subscribe(listener);
  }

  toggleHistory(): void {
    this.dispatch({ type: "ui/panel-set", panel: "history", toggle: true });
    this.host.scheduleRender();
  }

  toggleChatActions(): void {
    this.dispatch({ type: "ui/panel-set", panel: "chat-actions", toggle: true });
    this.host.scheduleRender();
  }

  closeToolbarPanels(): void {
    this.close();
  }

  toggleStatus(): void {
    this.dispatch({ type: "ui/panel-set", panel: "status-panel", toggle: true });
    this.host.scheduleRender();
  }

  closeForThreadSelection(): void {
    this.host.archiveConfirm.set(null);
  }

  startArchive(threadId: string): void {
    this.host.archiveConfirm.set(threadId);
  }

  async archiveThread(threadId: string, saveMarkdown: boolean): Promise<void> {
    if (this.host.archiveConfirm.get() === threadId) this.host.archiveConfirm.set(null);
    await this.host.threadActions.archiveThread(threadId, saveMarkdown);
    this.host.scheduleRender();
  }

  closeOnOutsidePointer(context: ToolbarOutsidePointerContext): void {
    if (!this.hasOpenPanel()) return;

    const target = context.target;
    if (isToolbarElement(target, context.viewWindow)) {
      const insideToolbarPanel = target.closest(".codex-panel__toolbar-primary, .codex-panel__toolbar-panel");
      if (insideToolbarPanel && context.contains(insideToolbarPanel)) {
        if (this.host.archiveConfirm.get() && !target.closest(".codex-panel__archive-confirm")) {
          this.host.archiveConfirm.set(null);
        }
        return;
      }
    }

    if (this.host.archiveConfirm.get()) {
      this.host.archiveConfirm.set(null);
    }

    if (context.renameEditing) return;

    this.close();
  }

  private hasOpenPanel(): boolean {
    return this.state.ui.toolbarPanel !== null;
  }

  private close(): void {
    if (!this.hasOpenPanel()) return;

    this.dispatch({ type: "ui/panel-set", panel: null });
    this.host.archiveConfirm.set(null);
    this.host.scheduleRender();
  }
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
