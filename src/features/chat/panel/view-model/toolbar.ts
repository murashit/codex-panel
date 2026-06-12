import type { Thread } from "../../../../domain/threads/model";
import { getThreadTitle } from "../../../../domain/threads/model";
import { runtimeConfigSections, rateLimitSummary } from "../../display/runtime-status";
import type { RuntimeConfigSection, RateLimitSummary } from "../../display/runtime-status";
import { connectionDiagnosticSections } from "../../display/diagnostics";
import type { RuntimeSnapshot } from "../../runtime/model";
import type { ChatState } from "../../state/reducer";

export interface ToolbarThreadRow {
  title: string;
  threadId: string;
  selected: boolean;
  disabled: boolean;
  canArchive: boolean;
  archiveConfirm?: { active: boolean; defaultSaveMarkdown: boolean };
  rename: {
    draft: string;
    generating: boolean;
  } | null;
}

interface ToolbarDiagnosticRow {
  label: string;
  value: string;
  level?: "normal" | "warning" | "error";
}

export interface ToolbarDiagnosticSection {
  title: string;
  rows: ToolbarDiagnosticRow[];
}

export interface ToolbarViewModel {
  newChatDisabled: boolean;
  chatActionsOpen: boolean;
  historyOpen: boolean;
  statusPanelOpen: boolean;
  rateLimit: RateLimitSummary | null;
  configSections: RuntimeConfigSection[];
  openPanel: "history" | "chat-actions" | "status" | null;
  threads: ToolbarThreadRow[];
  connectLabel: string;
  diagnostics: ToolbarDiagnosticSection[];
}

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
