import type { ReasoningEffort } from "../../../../generated/app-server/ReasoningEffort";
import type { RuntimeSnapshot } from "../../../../runtime/effective-settings";
import type { ChatState } from "../../chat-state";
import type { ToolbarThreadRow } from "../../toolbar-model";

export interface RuntimeSnapshotInput {
  state: ChatState;
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

export interface RestoredThreadTitleSnapshot {
  threadId: string;
  title: string | null;
  explicitName: string | null;
}
