import type { ReasoningEffort } from "../../../../generated/app-server/ReasoningEffort";
import type { RuntimeSnapshot } from "../../../../runtime/state";
import type { CodexChatHost } from "../../chat-host";
import type { ChatAction, ChatState } from "../../chat-state";
import type { ToolbarThreadRow } from "../../toolbar-model";
import type { ChatViewEffects } from "../effects";
import type { ChatViewRenderScheduleOptions } from "../lifecycle";
import type { RestoredThreadTitleSnapshot } from "../model";
import type { ChatViewSlotRendererPorts } from "./types";

interface ChatSlotToolbarCommands {
  archiveConfirmId: () => string | null;
  renameState: (threadId: string) => ToolbarThreadRow["rename"];
  toggleChatActions: () => void;
  closeToolbarPanels: () => void;
  toggleHistory: () => void;
  toggleStatus: () => void;
  startArchive: (threadId: string) => void;
  archiveThread: (threadId: string, saveMarkdown: boolean) => Promise<void>;
}

interface ChatSlotThreadCommands {
  compactThread: (threadId: string) => Promise<void>;
  selectThreadFromToolbar: (threadId: string) => Promise<void>;
  startRename: (threadId: string) => void;
  updateRenameDraft: (threadId: string, value: string) => void;
  saveRename: (threadId: string, value: string) => Promise<void>;
  cancelRename: (threadId: string) => void;
  autoNameDraft: (threadId: string) => Promise<void>;
}

interface ChatSlotConnectionCommands {
  ensureConnected: () => Promise<void>;
  reconnectPanel: () => Promise<void>;
  refreshStatusPanel: () => Promise<void>;
}

interface ChatSlotGoalCommands {
  setStatus: (threadId: string, status: "active" | "paused") => Promise<unknown>;
  clear: (threadId: string) => Promise<unknown>;
  setObjective: (threadId: string, objective: string, tokenBudget: number | null) => Promise<unknown>;
}

interface ChatSlotAppServerCommands {
  startThread: (prompt: string, options: { syncGoal: boolean }) => Promise<{ thread: { id: string } } | null>;
}

interface ChatSlotRenderCommands {
  render: (options?: ChatViewRenderScheduleOptions) => void;
  renderMessages: (parent: HTMLElement) => void;
  renderComposer: (parent: HTMLElement) => void;
}

export interface ChatViewSlotRendererPortsOptions {
  plugin: CodexChatHost;
  state: () => ChatState;
  connected: () => boolean;
  turnBusy: () => boolean;
  restoredPlaceholder: () => RestoredThreadTitleSnapshot | null;
  runtimeSnapshot: () => RuntimeSnapshot;
  toolbarCommands: ChatSlotToolbarCommands;
  threadCommands: ChatSlotThreadCommands;
  connectionCommands: ChatSlotConnectionCommands;
  goalCommands: ChatSlotGoalCommands;
  appServerCommands: ChatSlotAppServerCommands;
  renderCommands: ChatSlotRenderCommands;
  effects: ChatViewEffects;
  dispatch: (action: ChatAction) => void;
  startNewThread: () => Promise<void>;
  setRequestedModelFromUi: (model: string | null) => Promise<void>;
  setRequestedReasoningEffortFromUi: (effort: ReasoningEffort | null) => Promise<void>;
}

export function createChatViewSlotRendererPorts(options: ChatViewSlotRendererPortsOptions): ChatViewSlotRendererPorts {
  const { plugin } = options;
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
        archiveConfirmId: options.toolbarCommands.archiveConfirmId,
        renameState: options.toolbarCommands.renameState,
        startNewThread: options.startNewThread,
        toggleChatActions: () => {
          options.toolbarCommands.toggleChatActions();
        },
        compactConversation: () => {
          options.toolbarCommands.closeToolbarPanels();
          return compactConversation(options);
        },
        showGoalEditor: () => {
          setGoalEditingOpen(options, true, { closeToolbarPanel: true });
        },
        toggleHistory: () => {
          options.toolbarCommands.toggleHistory();
        },
        toggleStatusPanel: () => {
          options.toolbarCommands.toggleStatus();
        },
        reconnectPanel: options.connectionCommands.reconnectPanel,
        refreshStatusPanel: options.connectionCommands.refreshStatusPanel,
        selectThreadFromToolbar: options.threadCommands.selectThreadFromToolbar,
        startArchive: (threadId) => {
          options.toolbarCommands.startArchive(threadId);
        },
        archiveThread: options.toolbarCommands.archiveThread,
        startRename: (threadId) => {
          options.threadCommands.startRename(threadId);
        },
        updateRenameDraft: (threadId, value) => {
          options.threadCommands.updateRenameDraft(threadId, value);
        },
        saveRename: options.threadCommands.saveRename,
        cancelRename: (threadId) => {
          options.threadCommands.cancelRename(threadId);
        },
        autoNameDraft: options.threadCommands.autoNameDraft,
      },
      goal: {
        saveObjective: (objective, tokenBudget) => saveGoalObjective(options, objective, tokenBudget),
        setStatus: options.goalCommands.setStatus,
        clear: options.goalCommands.clear,
        setEditingOpen: (open) => {
          setGoalEditingOpen(options, open);
        },
      },
    },
    slots: {
      renderMessages: (parent) => {
        options.renderCommands.renderMessages(parent);
      },
      renderComposer: (parent) => {
        options.renderCommands.renderComposer(parent);
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
  await options.threadCommands.compactThread(threadId);
}

function setGoalEditingOpen(
  options: ChatViewSlotRendererPortsOptions,
  open: boolean,
  { closeToolbarPanel = false }: { closeToolbarPanel?: boolean } = {},
): void {
  if (closeToolbarPanel) options.dispatch({ type: "ui/panel-set", panel: null });
  options.dispatch({ type: "ui/detail-open-set", key: "goal:editor", open });
  options.renderCommands.render({ forceSlots: true });
}

async function saveGoalObjective(options: ChatViewSlotRendererPortsOptions, objective: string, tokenBudget: number | null): Promise<void> {
  let threadId = options.state().activeThread.id;
  if (!threadId) {
    try {
      await options.connectionCommands.ensureConnected();
      const response = await options.appServerCommands.startThread(objective, { syncGoal: false });
      threadId = response?.thread.id ?? null;
    } catch (error) {
      options.effects.status.addSystemMessage(error instanceof Error ? error.message : String(error));
      return;
    }
  }
  if (!threadId) return;
  void options.goalCommands.setObjective(threadId, objective, tokenBudget);
}
