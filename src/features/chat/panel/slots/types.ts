import type { ReasoningEffort } from "../../../../domain/catalog/metadata";
import type { RuntimeSnapshot } from "../../runtime/effective-settings";
import type { SendShortcut } from "../../../../shared/ui/keyboard";
import type { ChatState } from "../../chat-state";
import type { ToolbarActions } from "../../ui/toolbar";
import type { ToolbarThreadRow } from "../model/types";
import type { RestoredThreadTitleSnapshot } from "../model";

interface ChatViewToolbarActions extends ToolbarActions {
  archiveConfirmId: () => string | null;
  renameState: (threadId: string) => ToolbarThreadRow["rename"];
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
