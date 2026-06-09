import type { ReasoningEffort } from "../../../../domain/catalog/metadata";
import type { RuntimeSnapshot } from "../../runtime/effective-settings";
import type { EffectiveConfigSection, RateLimitSummary } from "../../runtime/status-summary";
import type { ChatState } from "../../chat-state";

export interface RuntimeSnapshotInput {
  effectiveConfig: ChatState["connection"]["effectiveConfig"];
  activeThread: Pick<ChatState["activeThread"], "id" | "tokenUsage">;
  runtime: ChatState["runtime"];
  rateLimit: ChatState["connection"]["rateLimit"];
  displayItems: ChatState["transcript"]["displayItems"];
  availableModels: ChatState["connection"]["availableModels"];
}

export interface ComposerMetaViewModel {
  fatal: string | null;
  context: ComposerContextMeterViewModel;
  statusSummary: string;
  model: string;
  effort: string | null;
  planActive: boolean;
  autoReviewActive: boolean;
  fastActive: boolean;
  modelChoices?: RuntimeChoice[];
  effortChoices?: RuntimeChoice[];
}

export interface RuntimeChoice {
  label: string;
  selected?: boolean;
  disabled?: boolean;
  meta?: string;
  onClick: () => void;
}

export interface ComposerContextMeterCellViewModel {
  text: string;
  placeholder: boolean;
}

export interface ComposerContextMeterViewModel {
  cells: ComposerContextMeterCellViewModel[];
  percent: string;
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

interface ToolbarDiagnosticRow {
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
  chatActionsOpen: boolean;
  historyOpen: boolean;
  statusPanelOpen: boolean;
  rateLimit: RateLimitSummary | null;
  configSections: EffectiveConfigSection[];
  openPanel: "history" | "chat-actions" | "status" | null;
  threads: ToolbarThreadRow[];
  connectLabel: string;
  diagnostics: ToolbarDiagnosticSection[];
}

export interface ToolbarViewModelInput {
  state: ChatState;
  snapshot: RuntimeSnapshot;
  connected: boolean;
  turnBusy: boolean;
  vaultPath: string;
  configuredCommand: string;
  archiveConfirmThreadId: string | null;
  archiveExportEnabled: boolean;
  renameState: (threadId: string) => ToolbarThreadRow["rename"];
}

export interface ConnectionDiagnosticsModelInput {
  state: ChatState;
  connected: boolean;
  configuredCommand: string;
}

export interface RuntimeComposerChoicesInput {
  state: ChatState;
  snapshot: RuntimeSnapshot;
  setRequestedModel: (model: string | null) => void;
  setRequestedReasoningEffort: (effort: ReasoningEffort | null) => void;
}

export interface StatusSummaryLinesInput {
  activeThreadId: ChatState["activeThread"]["id"];
  snapshot: RuntimeSnapshot;
}

export interface ModelStatusLinesInput {
  effectiveConfig: ChatState["connection"]["effectiveConfig"];
  requestedModel: ChatState["runtime"]["requestedModel"];
  snapshot: RuntimeSnapshot;
  collaborationModeLabel: string;
}

export interface EffortStatusLinesInput {
  effectiveConfig: ChatState["connection"]["effectiveConfig"];
  requestedReasoningEffort: ChatState["runtime"]["requestedReasoningEffort"];
  snapshot: RuntimeSnapshot;
}

export interface RestoredThreadTitleSnapshot {
  threadId: string;
  title: string | null;
  explicitName: string | null;
}
