import type { ReasoningEffort } from "../../../generated/app-server/ReasoningEffort";
import type { RuntimeSnapshot } from "../../../runtime/state";
import type { SendShortcut } from "../../../shared/ui/keyboard";
import type { ChatState } from "../chat-state";
import { pendingRequestsSignature as requestStateSignature } from "../requests/view-model";
import type { ToolbarThreadRow } from "../toolbar-model";
import { renderGoalBanner } from "../ui/goal-banner";
import { renderToolbar } from "../ui/toolbar";
import type { RestoredThreadTitleSnapshot } from "./model";
import {
  activeComposerThreadName as buildActiveComposerThreadName,
  composerMetaViewModel as buildComposerMetaViewModel,
  composerPlaceholder as buildComposerPlaceholder,
  runtimeComposerChoices,
  toolbarViewModel as buildToolbarViewModel,
} from "./model";

export interface ChatViewToolbarActions {
  archiveConfirmId: () => string | null;
  renameState: (threadId: string) => ToolbarThreadRow["rename"];
  startNewThread: () => Promise<void>;
  toggleChatActions: () => void;
  compactConversation: () => Promise<void>;
  showGoalEditor: () => void;
  toggleHistory: () => void;
  toggleStatusPanel: () => void;
  reconnectPanel: () => Promise<void>;
  refreshStatusPanel: () => Promise<void>;
  selectThreadFromToolbar: (threadId: string) => Promise<void>;
  startArchive: (threadId: string) => void;
  archiveThread: (threadId: string, saveMarkdown: boolean) => Promise<void>;
  startRename: (threadId: string) => void;
  updateRenameDraft: (threadId: string, value: string) => void;
  saveRename: (threadId: string, value: string) => Promise<void>;
  cancelRename: (threadId: string) => void;
  autoNameDraft: (threadId: string) => Promise<void>;
}

export interface ChatViewGoalActions {
  saveObjective: (objective: string, tokenBudget: number | null) => Promise<void>;
  setStatus: (threadId: string, status: "active" | "paused") => Promise<unknown>;
  clear: (threadId: string) => Promise<unknown>;
  setEditingOpen: (open: boolean) => void;
}

export interface ChatViewSlotRendererHost {
  state: {
    chat: () => ChatState;
    connected: () => boolean;
    turnBusy: () => boolean;
  };
  settings: {
    vaultPath: () => string;
    configuredCommand: () => string;
    archiveExportEnabled: () => boolean;
    sendShortcut: () => SendShortcut;
  };
  thread: {
    restoredPlaceholder: () => RestoredThreadTitleSnapshot | null;
  };
  runtime: {
    snapshot: () => RuntimeSnapshot;
    setRequestedModel: (model: string | null) => Promise<void>;
    setRequestedReasoningEffort: (effort: ReasoningEffort | null) => Promise<void>;
  };
  actions: {
    toolbar: ChatViewToolbarActions;
    goal: ChatViewGoalActions;
  };
  slots: {
    renderMessages: (parent: HTMLElement) => void;
    renderComposer: (parent: HTMLElement) => void;
  };
}

export class ChatViewSlotRenderers {
  constructor(private readonly host: ChatViewSlotRendererHost) {}

  renderToolbar(toolbar: HTMLElement): void {
    renderToolbar(toolbar, this.toolbarViewModel(), {
      startNewThread: () => void this.host.actions.toolbar.startNewThread(),
      toggleChatActions: () => {
        this.host.actions.toolbar.toggleChatActions();
      },
      compactConversation: () => {
        void this.host.actions.toolbar.compactConversation();
      },
      setGoal: () => {
        this.host.actions.toolbar.showGoalEditor();
      },
      toggleHistory: () => {
        this.host.actions.toolbar.toggleHistory();
      },
      toggleStatusPanel: () => {
        this.host.actions.toolbar.toggleStatusPanel();
      },
      connect: () => void this.host.actions.toolbar.reconnectPanel(),
      refreshStatus: () => void this.host.actions.toolbar.refreshStatusPanel(),
      resumeThread: (threadId) => void this.host.actions.toolbar.selectThreadFromToolbar(threadId),
      startArchiveThread: (threadId) => {
        this.host.actions.toolbar.startArchive(threadId);
      },
      archiveThread: (threadId, saveMarkdown) => void this.host.actions.toolbar.archiveThread(threadId, saveMarkdown),
      startRenameThread: (threadId) => {
        this.host.actions.toolbar.startRename(threadId);
      },
      updateRenameDraft: (threadId, value) => {
        this.host.actions.toolbar.updateRenameDraft(threadId, value);
      },
      saveRenameThread: (threadId, value) => void this.host.actions.toolbar.saveRename(threadId, value),
      cancelRenameThread: (threadId) => {
        this.host.actions.toolbar.cancelRename(threadId);
      },
      autoNameThread: (threadId) => void this.host.actions.toolbar.autoNameDraft(threadId),
    });
  }

  renderGoal(goal: HTMLElement): void {
    const state = this.host.state.chat();
    renderGoalBanner(
      goal,
      state.activeThread.goal,
      {
        onSave: (objective, tokenBudget) => {
          void this.host.actions.goal.saveObjective(objective, tokenBudget);
        },
        onPause: () => {
          const threadId = this.host.state.chat().activeThread.id;
          if (!threadId) return;
          void this.host.actions.goal.setStatus(threadId, "paused");
        },
        onResume: () => {
          const threadId = this.host.state.chat().activeThread.id;
          if (!threadId) return;
          void this.host.actions.goal.setStatus(threadId, "active");
        },
        onClear: () => {
          const threadId = this.host.state.chat().activeThread.id;
          if (!threadId) return;
          void this.host.actions.goal.clear(threadId);
        },
      },
      {
        sendShortcut: this.host.settings.sendShortcut(),
        editingRequested: state.ui.openDetails.has("goal:editor"),
        onEditingChange: (editing) => {
          this.host.actions.goal.setEditingOpen(editing);
        },
      },
    );
  }

  renderMessages(parent: HTMLElement): void {
    this.host.slots.renderMessages(parent);
  }

  renderComposer(parent: HTMLElement): void {
    this.host.slots.renderComposer(parent);
  }

  composerPlaceholder(): string {
    return buildComposerPlaceholder(this.activeComposerThreadName());
  }

  composerMetaViewModel() {
    return {
      ...buildComposerMetaViewModel(this.host.state.chat(), this.host.runtime.snapshot()),
      ...runtimeComposerChoices({
        state: this.host.state.chat(),
        snapshot: this.host.runtime.snapshot(),
        setRequestedModel: (model) => void this.host.runtime.setRequestedModel(model),
        setRequestedReasoningEffort: (effort) => void this.host.runtime.setRequestedReasoningEffort(effort),
      }),
    };
  }

  activeComposerThreadName(): string | null {
    return buildActiveComposerThreadName(this.host.state.chat(), this.host.thread.restoredPlaceholder());
  }

  pendingRequestsSignature(): string {
    const state = this.host.state.chat();
    return requestStateSignature(state.requests.approvals, state.requests.pendingUserInputs, state.requests.userInputDrafts);
  }

  private toolbarViewModel() {
    return buildToolbarViewModel({
      state: this.host.state.chat(),
      snapshot: this.host.runtime.snapshot(),
      connected: this.host.state.connected(),
      turnBusy: this.host.state.turnBusy(),
      vaultPath: this.host.settings.vaultPath(),
      configuredCommand: this.host.settings.configuredCommand(),
      archiveConfirmThreadId: this.host.actions.toolbar.archiveConfirmId(),
      archiveExportEnabled: this.host.settings.archiveExportEnabled(),
      renameState: (threadId) => this.host.actions.toolbar.renameState(threadId),
    });
  }
}
