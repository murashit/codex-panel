import type { HookItem, ModelMetadata, ReasoningEffort } from "../../domain/catalog/metadata";
import type { Thread } from "../../domain/threads/model";

export interface PanelHelpersViewModel {
  threadNamingModel: string | null;
  threadNamingEffort: ReasoningEffort | null;
  rewriteSelectionModel: string | null;
  rewriteSelectionEffort: ReasoningEffort | null;
  models: readonly ModelMetadata[];
  modelError: string | null;
  onThreadNamingModelChange: (value: string | null) => void;
  onThreadNamingEffortChange: (value: ReasoningEffort | null) => void;
  onRewriteSelectionModelChange: (value: string | null) => void;
  onRewriteSelectionEffortChange: (value: ReasoningEffort | null) => void;
}

export interface ArchivedThreadsViewModel {
  threads: readonly Thread[] | null;
  loading: boolean;
  error: string | null;
  deleteConfirmThreadId: string | null;
  onRestore: (threadId: string) => void;
  onStartDelete: (threadId: string) => void;
  onDelete: (threadId: string) => void;
}

export interface CodexHooksViewModel {
  catalog: { hooks: readonly HookItem[]; warnings: readonly string[]; errors: readonly string[] } | null;
  loading: boolean;
  error: string | null;
  onTrust: (hook: HookItem) => void;
  onToggleEnabled: (hook: HookItem, enabled: boolean) => void;
}
