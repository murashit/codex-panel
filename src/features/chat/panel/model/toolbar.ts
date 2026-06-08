import type { Thread } from "../../../../generated/app-server/v2/Thread";
import { getThreadTitle } from "../../../../domain/threads/model";
import { effectiveConfigSections, rateLimitSummary } from "../../../../runtime/status-summary";
import type { ToolbarThreadRow, ToolbarViewModel } from "../../toolbar-model";
import { connectionDiagnosticsModel } from "./diagnostics";
import type { ToolbarViewModelInput } from "./types";

export function toolbarViewModel(input: ToolbarViewModelInput): ToolbarViewModel {
  const { state, snapshot } = input;
  const limit = rateLimitSummary(snapshot);
  const historyOpen = state.ui.openDetails.has("history");
  const chatActionsOpen = state.ui.openDetails.has("chat-actions");
  const statusPanelOpen = state.ui.openDetails.has("status-panel");
  return {
    newChatDisabled: input.turnBusy,
    chatActionsOpen,
    historyOpen,
    statusPanelOpen,
    rateLimit: limit,
    configSections: effectiveConfigSections(snapshot, input.vaultPath),
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
