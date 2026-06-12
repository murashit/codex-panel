import type { ChatState } from "../state/reducer";
import type { ReasoningEffort } from "../../../domain/catalog/metadata";
import type { RuntimeSnapshot } from "../runtime/model";
import type { SendShortcut } from "../../../shared/ui/keyboard";
import type { ToolbarActions } from "../ui/toolbar";
import type { RestoredThreadTitleSnapshot } from "./view-model/thread-title";
import type { ToolbarThreadRow } from "./view-model/toolbar";

interface ChatPanelToolbarState {
  archiveConfirmId: () => string | null;
  archiveConfirmSubscribe: (listener: () => void) => () => void;
  renameState: (threadId: string) => ToolbarThreadRow["rename"];
  renameSubscribe: (listener: () => void) => () => void;
}

type ChatPanelToolbarActions = ToolbarActions;

interface ChatPanelGoalActions {
  saveObjective: (objective: string, tokenBudget: number | null) => Promise<void>;
  setStatus: (threadId: string, status: "active" | "paused") => Promise<unknown>;
  clear: (threadId: string) => Promise<unknown>;
  setEditingOpen: (open: boolean) => void;
}

export interface ChatPanelStatePort {
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

export interface ChatPanelComposerPorts extends ChatPanelStatePort {
  thread: {
    restoredPlaceholder: () => RestoredThreadTitleSnapshot | null;
  };
  runtime: {
    snapshot: () => RuntimeSnapshot;
    requestModel: (model: string) => Promise<void>;
    requestReasoningEffort: (effort: ReasoningEffort) => Promise<void>;
    resetReasoningEffortToConfig: () => Promise<void>;
  };
}
