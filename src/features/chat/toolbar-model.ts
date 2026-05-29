import type { EffectiveConfigSection, RateLimitSummary } from "../../runtime/view";

export type ToolbarPanelKind = "history" | "status" | "runtime";
export type ToolbarStatusState = "offline" | "ready" | "degraded" | "blocked" | "running";

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
  statusState: ToolbarStatusState;
  historyOpen: boolean;
  statusPanelOpen: boolean;
  runtimeOpen: boolean;
  planActive: boolean;
  autoReviewActive: boolean;
  fastActive: boolean;
  runtimeSummary: string;
  runtimeTitle: string;
  runtimeEmphasized: boolean;
  context: { level: "ok" | "warn" | "danger"; title: string; label: string; percent: number | null } | null;
  rateLimit: RateLimitSummary | null;
  configSections: EffectiveConfigSection[];
  openPanel: ToolbarPanelKind | null;
  threads: ToolbarThreadRow[];
  modelChoices: ToolbarChoice[];
  effortChoices: ToolbarChoice[];
  connectLabel: string;
  diagnostics: ToolbarDiagnosticSection[];
}
