import type { EffectiveConfigSection, RateLimitSummary } from "../../runtime/view";

export type ToolbarPanelKind = "history" | "status";

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
  newChatDisabled: boolean;
  historyOpen: boolean;
  statusPanelOpen: boolean;
  rateLimit: RateLimitSummary | null;
  configSections: EffectiveConfigSection[];
  openPanel: ToolbarPanelKind | null;
  threads: ToolbarThreadRow[];
  connectLabel: string;
  diagnostics: ToolbarDiagnosticSection[];
}
