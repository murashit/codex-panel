import type { HookItem, ModelMetadata, ReasoningEffort } from "../domain/catalog/metadata";
import type { Thread } from "../domain/threads/model";

export interface HelperSettingsState {
  threadNamingModel: string | null;
  threadNamingEffort: ReasoningEffort | null;
  rewriteSelectionModel: string | null;
  rewriteSelectionEffort: ReasoningEffort | null;
  models: readonly ModelMetadata[];
  modelLoadFailed: boolean;
  modelStatus: string;
  onThreadNamingModelChange: (value: string | null) => void;
  onThreadNamingEffortChange: (value: ReasoningEffort | null) => void;
  onRewriteSelectionModelChange: (value: string | null) => void;
  onRewriteSelectionEffortChange: (value: ReasoningEffort | null) => void;
}

export interface ArchivedThreadSectionState {
  exportEnabled: boolean;
  exportFolderTemplate: string;
  exportFilenameTemplate: string;
  exportTags: string;
  threads: readonly Thread[];
  contentAvailable: boolean;
  loaded: boolean;
  loading: boolean;
  status: string;
  deleteConfirmThreadId: string | null;
  onExportEnabledChange: (enabled: boolean) => void;
  onExportFolderTemplateChange: (value: string) => void;
  onExportFilenameTemplateChange: (value: string) => void;
  onExportTagsChange: (value: string) => void;
  onRestore: (threadId: string) => void;
  onStartDelete: (threadId: string) => void;
  onDelete: (threadId: string) => void;
}

export interface HookSectionState {
  hooks: readonly HookItem[];
  warnings: readonly string[];
  errors: readonly string[];
  contentAvailable: boolean;
  loaded: boolean;
  loading: boolean;
  status: string;
  onTrust: (hook: HookItem) => void;
  onToggleEnabled: (hook: HookItem, enabled: boolean) => void;
}

export interface SettingsSectionsState {
  helper: HelperSettingsState;
  archived: ArchivedThreadSectionState;
  hooks: HookSectionState;
}
