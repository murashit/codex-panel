import type { EffectiveConfigSection, RateLimitSummary } from "../../runtime/view";

export type ToolbarPanelKind = "history" | "status" | "runtime";

export interface ToolbarChoice {
  label: string;
  selected?: boolean;
  disabled?: boolean;
  meta?: string;
  onClick: () => void;
}

export interface ToolbarThreadRow {
  title: string;
  threadId: string;
  selected: boolean;
  disabled: boolean;
  canArchive: boolean;
  archiveConfirm?: { active: boolean; defaultSaveMarkdown: boolean };
  rename: {
    draft: string;
    generating: boolean;
  } | null;
}

export interface ToolbarDiagnosticRow {
  label: string;
  value: string;
  level?: "normal" | "warning" | "error";
}

export interface ToolbarDiagnosticSection {
  title: string;
  rows: ToolbarDiagnosticRow[];
}

export interface ToolbarViewModel {
  connected: boolean;
  status: string;
  historyOpen: boolean;
  statusPanelOpen: boolean;
  runtimeOpen: boolean;
  planActive: boolean;
  autoReviewActive: boolean;
  fastActive: boolean;
  rateLimit: RateLimitSummary | null;
  configSections: EffectiveConfigSection[];
  openPanel: ToolbarPanelKind | null;
  threads: ToolbarThreadRow[];
  modelChoices: ToolbarChoice[];
  effortChoices: ToolbarChoice[];
  connectLabel: string;
  diagnostics: ToolbarDiagnosticSection[];
}
