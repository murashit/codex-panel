import type { ChatState } from "../../chat-state";
import type { ReasoningEffort } from "../../../../domain/catalog/metadata";
import type { RuntimeSnapshot } from "../../runtime/effective-settings";
import type { SendShortcut } from "../../../../shared/ui/keyboard";
import type { ToolbarActions } from "../../ui/toolbar";
import type { ToolbarThreadRow } from "../model/types";
import type { RestoredThreadTitleSnapshot } from "../model";

interface ChatPanelToolbarState {
  archiveConfirmId: () => string | null;
  renameState: (threadId: string) => ToolbarThreadRow["rename"];
}

type ChatPanelToolbarActions = ToolbarActions;

interface ChatPanelGoalActions {
  saveObjective: (objective: string, tokenBudget: number | null) => Promise<void>;
  setStatus: (threadId: string, status: "active" | "paused") => Promise<unknown>;
  clear: (threadId: string) => Promise<unknown>;
  setEditingOpen: (open: boolean) => void;
}

interface ChatPanelStatePort {
  state: {
    chat: () => ChatState;
  };
}

export interface ChatPanelToolbarPorts extends ChatPanelStatePort {
  state: ChatPanelStatePort["state"] & {
    connected: () => boolean;
    turnBusy: () => boolean;
  };
  settings: {
    vaultPath: () => string;
    configuredCommand: () => string;
    archiveExportEnabled: () => boolean;
  };
  runtime: {
    snapshot: () => RuntimeSnapshot;
  };
  view: {
    toolbar: ChatPanelToolbarState;
  };
  actions: {
    toolbar: ChatPanelToolbarActions;
  };
}

export interface ChatPanelGoalPorts extends ChatPanelStatePort {
  settings: {
    sendShortcut: () => SendShortcut;
  };
  actions: {
    goal: ChatPanelGoalActions;
  };
}

export type ChatPanelMessagesPorts = ChatPanelStatePort;

export interface ChatPanelComposerPorts extends ChatPanelStatePort {
  thread: {
    restoredPlaceholder: () => RestoredThreadTitleSnapshot | null;
  };
  runtime: {
    snapshot: () => RuntimeSnapshot;
    setRequestedModel: (model: string | null) => Promise<void>;
    setRequestedReasoningEffort: (effort: ReasoningEffort | null) => Promise<void>;
  };
}

export type ChatPanelUiPorts = ChatPanelToolbarPorts & ChatPanelGoalPorts & ChatPanelMessagesPorts & ChatPanelComposerPorts;
