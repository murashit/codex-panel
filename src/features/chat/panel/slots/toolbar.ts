import { renderToolbar } from "../../ui/toolbar";
import { toolbarViewModel as buildToolbarViewModel } from "../model";
import type { ChatViewSlotRendererPorts } from "./types";

export function renderToolbarSlot(toolbar: HTMLElement, ports: ChatViewSlotRendererPorts): void {
  renderToolbar(toolbar, toolbarViewModel(ports), {
    startNewThread: () => void ports.actions.toolbar.startNewThread(),
    toggleChatActions: () => {
      ports.actions.toolbar.toggleChatActions();
    },
    compactConversation: () => {
      void ports.actions.toolbar.compactConversation();
    },
    setGoal: () => {
      ports.actions.toolbar.showGoalEditor();
    },
    toggleHistory: () => {
      ports.actions.toolbar.toggleHistory();
    },
    toggleStatusPanel: () => {
      ports.actions.toolbar.toggleStatusPanel();
    },
    connect: () => void ports.actions.toolbar.reconnectPanel(),
    refreshStatus: () => void ports.actions.toolbar.refreshStatusPanel(),
    resumeThread: (threadId) => void ports.actions.toolbar.selectThreadFromToolbar(threadId),
    startArchiveThread: (threadId) => {
      ports.actions.toolbar.startArchive(threadId);
    },
    archiveThread: (threadId, saveMarkdown) => void ports.actions.toolbar.archiveThread(threadId, saveMarkdown),
    startRenameThread: (threadId) => {
      ports.actions.toolbar.startRename(threadId);
    },
    updateRenameDraft: (threadId, value) => {
      ports.actions.toolbar.updateRenameDraft(threadId, value);
    },
    saveRenameThread: (threadId, value) => void ports.actions.toolbar.saveRename(threadId, value),
    cancelRenameThread: (threadId) => {
      ports.actions.toolbar.cancelRename(threadId);
    },
    autoNameThread: (threadId) => void ports.actions.toolbar.autoNameDraft(threadId),
  });
}

function toolbarViewModel(ports: ChatViewSlotRendererPorts) {
  return buildToolbarViewModel({
    state: ports.state.chat(),
    snapshot: ports.runtime.snapshot(),
    connected: ports.state.connected(),
    turnBusy: ports.state.turnBusy(),
    vaultPath: ports.settings.vaultPath(),
    configuredCommand: ports.settings.configuredCommand(),
    archiveConfirmThreadId: ports.actions.toolbar.archiveConfirmId(),
    archiveExportEnabled: ports.settings.archiveExportEnabled(),
    renameState: (threadId) => ports.actions.toolbar.renameState(threadId),
  });
}
