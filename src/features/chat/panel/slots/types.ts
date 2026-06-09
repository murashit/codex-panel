import type { ReasoningEffort } from "../../../../domain/catalog/reasoning-effort";
import type { RuntimeSnapshot } from "../../runtime/effective-settings";
import type { SendShortcut } from "../../../../shared/ui/keyboard";
import type { ChatState } from "../../chat-state";
import type { ToolbarThreadRow } from "../model/types";
import type { RestoredThreadTitleSnapshot } from "../model";

interface ChatViewToolbarActions {
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

interface ChatViewGoalActions {
  saveObjective: (objective: string, tokenBudget: number | null) => Promise<void>;
  setStatus: (threadId: string, status: "active" | "paused") => Promise<unknown>;
  clear: (threadId: string) => Promise<unknown>;
  setEditingOpen: (open: boolean) => void;
}

export interface ChatViewSlotRendererPorts {
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
