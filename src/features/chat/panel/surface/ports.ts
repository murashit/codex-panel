import type { Signal } from "@preact/signals";
import type { ReasoningEffort } from "../../../../domain/catalog/metadata";
import type { SendShortcut } from "../../../../shared/ui/keyboard";
import type { ToolbarActions } from "../../ui/toolbar";
import type { ToolbarThreadRow } from "../../ui/toolbar";

export interface RestoredThreadTitleSnapshot {
  threadId: string;
  title: string | null;
  explicitName: string | null;
}

interface ChatPanelToolbarState {
  archiveConfirm: Signal<string | null>;
  renameState: (threadId: string) => ToolbarThreadRow["rename"];
  renameVersion: Signal<number>;
}

type ChatPanelToolbarActions = ToolbarActions;

interface ChatPanelGoalActions {
  saveObjective: (objective: string, tokenBudget: number | null) => Promise<void>;
  setStatus: (threadId: string, status: "active" | "paused") => Promise<unknown>;
  clear: (threadId: string) => Promise<unknown>;
  setEditingOpen: (open: boolean) => void;
}

export interface ChatPanelToolbarPorts {
  state: {
    connected: () => boolean;
  };
  settings: {
    vaultPath: () => string;
    configuredCommand: () => string;
    archiveExportEnabled: () => boolean;
  };
  view: {
    toolbar: ChatPanelToolbarState;
  };
  actions: {
    toolbar: ChatPanelToolbarActions;
  };
}

export interface ChatPanelGoalPorts {
  settings: {
    sendShortcut: () => SendShortcut;
  };
  actions: {
    goal: ChatPanelGoalActions;
  };
}

export interface ChatPanelComposerPorts {
  thread: {
    restoredPlaceholder: () => RestoredThreadTitleSnapshot | null;
  };
  runtime: {
    requestModel: (model: string) => Promise<void>;
    requestReasoningEffort: (effort: ReasoningEffort) => Promise<void>;
    resetReasoningEffortToConfig: () => Promise<void>;
  };
}

export interface ChatPanelSurfacePorts {
  toolbar: ChatPanelToolbarPorts;
  goal: ChatPanelGoalPorts;
  composer: ChatPanelComposerPorts;
}
