import type { ReasoningEffort } from "../../../../domain/catalog/metadata";
import type { SendShortcut } from "../../../../shared/ui/keyboard";

export interface RestoredThreadTitleSnapshot {
  threadId: string;
  title: string | null;
  explicitName: string | null;
}

export interface ChatPanelComposerContextMeterCell {
  text: string;
  placeholder: boolean;
}

export interface ChatPanelComposerContextMeter {
  cells: ChatPanelComposerContextMeterCell[];
  percent: string;
}

export interface ChatPanelComposerRuntimeChoice {
  label: string;
  selected?: boolean;
  disabled?: boolean;
  meta?: string;
  onClick: () => void;
}

export interface ChatPanelComposerMeta {
  fatal: string | null;
  context: ChatPanelComposerContextMeter;
  statusSummary: string;
  model: string;
  effort: string | null;
  planActive: boolean;
  autoReviewActive: boolean;
  fastActive: boolean;
  modelChoices?: ChatPanelComposerRuntimeChoice[];
  effortChoices?: ChatPanelComposerRuntimeChoice[];
}

export interface ChatPanelComposerProjection {
  placeholder: string;
  meta: ChatPanelComposerMeta;
}

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
  };
}
