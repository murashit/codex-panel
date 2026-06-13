import type { ReasoningEffort } from "../../../../domain/catalog/metadata";
import type { SendShortcut } from "../../../../shared/ui/keyboard";
import type { ToolbarActions } from "../../ui/toolbar";

export interface RestoredThreadTitleSnapshot {
  threadId: string;
  title: string | null;
  explicitName: string | null;
}

type ChatPanelToolbarActions = ToolbarActions;

interface ChatPanelGoalActions {
  saveObjective: (objective: string, tokenBudget: number | null) => Promise<void>;
  setStatus: (threadId: string, status: "active" | "paused") => Promise<unknown>;
  clear: (threadId: string) => Promise<unknown>;
  startEditing: (threadId: string | null, objective: string, tokenBudget: number | null) => void;
  updateObjectiveDraft: (objective: string) => void;
  setObjectiveExpanded: (threadId: string, expanded: boolean) => void;
  closeEditor: () => void;
}

export interface ChatPanelToolbarSurface {
  state: {
    connected: () => boolean;
    nowMs: () => number;
  };
  settings: {
    vaultPath: () => string;
    configuredCommand: () => string;
    archiveExportEnabled: () => boolean;
  };
  actions: {
    toolbar: ChatPanelToolbarActions;
  };
}

export interface ChatPanelGoalSurface {
  settings: {
    sendShortcut: () => SendShortcut;
  };
  actions: {
    goal: ChatPanelGoalActions;
  };
}

export interface ChatPanelComposerSurface {
  thread: {
    restoredPlaceholder: () => RestoredThreadTitleSnapshot | null;
  };
  runtime: {
    requestModel: (model: string) => Promise<void>;
    requestReasoningEffort: (effort: ReasoningEffort) => Promise<void>;
    resetReasoningEffortToConfig: () => Promise<void>;
  };
}

export interface ChatPanelSurface {
  toolbar: ChatPanelToolbarSurface;
  goal: ChatPanelGoalSurface;
  composer: ChatPanelComposerSurface;
}
