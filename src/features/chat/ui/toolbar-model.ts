export interface RateLimitSummary {
  rows: {
    label: string;
    value: string;
    resetLabel: string | null;
    percent: number;
    meterDivisions: number | null;
    level: "ok" | "warn" | "danger";
  }[];
}

export interface ToolbarThreadRow {
  title: string;
  threadId: string;
  selected: boolean;
  isPinned?: boolean;
  renameDisabled: boolean;
  archiveDisabled: boolean;
  archiveConfirm: { active: boolean; defaultSaveMarkdown: boolean };
  rename: {
    draft: string;
    generating: boolean;
    saving: boolean;
    autoNameDisabled: boolean;
  } | null;
}

export interface ToolbarStatusRow {
  label: string;
  value: string;
  level?: "normal" | "warning" | "error";
}

export interface ToolbarStatusSection {
  title: string;
  rows: ToolbarStatusRow[];
}

export interface ToolbarViewModel {
  newChatDisabled: boolean;
  sideChatStartDisabled: boolean;
  compactDisabled: boolean;
  goalMutationDisabled: boolean;
  rateLimit: RateLimitSummary | null;
  openPanel: "history" | "chat-actions" | "status" | null;
  threads: ToolbarThreadRow[];
  hasMoreThreads: boolean;
  threadListLoading: boolean;
  threadListFetching: boolean;
  loadingMoreThreads: boolean;
  threadListError: string | null;
  connectLabel: string;
  permissionsAndApprovals: ToolbarStatusSection[];
  diagnostics: ToolbarStatusSection[];
  toolInventory: ToolbarStatusSection[];
}
