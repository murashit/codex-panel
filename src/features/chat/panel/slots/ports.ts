import type { ReasoningEffort } from "../../../../generated/app-server/ReasoningEffort";
import type { RuntimeSnapshot } from "../../../../runtime/state";
import type { CodexChatHost } from "../../chat-host";
import type { ChatAction, ChatState } from "../../chat-state";
import type { ChatViewControllers } from "../controllers";
import type { ChatViewEffects } from "../effects";
import type { RestoredThreadTitleSnapshot } from "../model";
import type { ChatViewSlotRendererPorts } from "./types";

export interface ChatViewSlotRendererPortsOptions {
  plugin: CodexChatHost;
  state: () => ChatState;
  connected: () => boolean;
  turnBusy: () => boolean;
  restoredPlaceholder: () => RestoredThreadTitleSnapshot | null;
  runtimeSnapshot: () => RuntimeSnapshot;
  controllers: ChatViewControllers;
  effects: ChatViewEffects;
  dispatch: (action: ChatAction) => void;
  startNewThread: () => Promise<void>;
  setRequestedModelFromUi: (model: string | null) => Promise<void>;
  setRequestedReasoningEffortFromUi: (effort: ReasoningEffort | null) => Promise<void>;
}

export function createChatViewSlotRendererPorts(options: ChatViewSlotRendererPortsOptions): ChatViewSlotRendererPorts {
  const { controllers, plugin } = options;
  return {
    state: {
      chat: options.state,
      connected: options.connected,
      turnBusy: options.turnBusy,
    },
    settings: {
      vaultPath: () => plugin.vaultPath,
      configuredCommand: () => plugin.settings.codexPath,
      archiveExportEnabled: () => plugin.settings.archiveExportEnabled,
      sendShortcut: () => plugin.settings.sendShortcut,
    },
    thread: {
      restoredPlaceholder: options.restoredPlaceholder,
    },
    runtime: {
      snapshot: options.runtimeSnapshot,
      setRequestedModel: options.setRequestedModelFromUi,
      setRequestedReasoningEffort: options.setRequestedReasoningEffortFromUi,
    },
    actions: {
      toolbar: {
        archiveConfirmId: () => controllers.toolbar.panels.archiveConfirmId(),
        renameState: (threadId) => controllers.thread.rename.editState(threadId),
        startNewThread: options.startNewThread,
        toggleChatActions: () => {
          controllers.toolbar.panels.toggleChatActions();
        },
        compactConversation: () => {
          controllers.toolbar.panels.closeToolbarPanels();
          return compactConversation(options);
        },
        showGoalEditor: () => {
          setGoalEditingOpen(options, true, { closeToolbarPanel: true });
        },
        toggleHistory: () => {
          controllers.toolbar.panels.toggleHistory();
        },
        toggleStatusPanel: () => {
          controllers.toolbar.panels.toggleStatus();
        },
        reconnectPanel: () => controllers.connection.reconnect.reconnectPanel(),
        refreshStatusPanel: () => controllers.connection.controller.refreshStatusPanel(),
        selectThreadFromToolbar: (threadId) => controllers.thread.selection.selectThreadFromToolbar(threadId),
        startArchive: (threadId) => {
          controllers.toolbar.panels.startArchive(threadId);
        },
        archiveThread: (threadId, saveMarkdown) => controllers.toolbar.panels.archiveThread(threadId, saveMarkdown),
        startRename: (threadId) => {
          controllers.thread.rename.start(threadId);
        },
        updateRenameDraft: (threadId, value) => {
          controllers.thread.rename.updateDraft(threadId, value);
        },
        saveRename: (threadId, value) => controllers.thread.rename.save(threadId, value),
        cancelRename: (threadId) => {
          controllers.thread.rename.cancel(threadId);
        },
        autoNameDraft: (threadId) => controllers.thread.rename.autoNameDraft(threadId),
      },
      goal: {
        saveObjective: (objective, tokenBudget) => saveGoalObjective(options, objective, tokenBudget),
        setStatus: (threadId, status) => controllers.runtime.goals.setStatus(threadId, status),
        clear: (threadId) => controllers.runtime.goals.clear(threadId),
        setEditingOpen: (open) => {
          setGoalEditingOpen(options, open);
        },
      },
    },
    slots: {
      renderMessages: (parent) => {
        controllers.render.messages.render(parent);
      },
      renderComposer: (parent) => {
        controllers.composer.controller.render(parent);
      },
    },
  };
}

async function compactConversation(options: ChatViewSlotRendererPortsOptions): Promise<void> {
  const threadId = options.state().activeThread.id;
  if (!threadId) {
    options.effects.status.addSystemMessage("No active thread to compact.");
    return;
  }
  await options.controllers.thread.actions.compactThread(threadId);
}

function setGoalEditingOpen(
  options: ChatViewSlotRendererPortsOptions,
  open: boolean,
  { closeToolbarPanel = false }: { closeToolbarPanel?: boolean } = {},
): void {
  if (closeToolbarPanel) options.dispatch({ type: "ui/panel-set", panel: null });
  options.dispatch({ type: "ui/detail-open-set", key: "goal:editor", open });
  options.controllers.render.controller.render({ forceSlots: true });
}

async function saveGoalObjective(options: ChatViewSlotRendererPortsOptions, objective: string, tokenBudget: number | null): Promise<void> {
  let threadId = options.state().activeThread.id;
  if (!threadId) {
    try {
      await options.controllers.connection.controller.ensureConnected();
      const response = await options.controllers.appServer.threads.startThread(objective, { syncGoal: false });
      threadId = response?.thread.id ?? null;
    } catch (error) {
      options.effects.status.addSystemMessage(error instanceof Error ? error.message : String(error));
      return;
    }
  }
  if (!threadId) return;
  void options.controllers.runtime.goals.setObjective(threadId, objective, tokenBudget);
}
