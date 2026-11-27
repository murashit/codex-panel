import type { ThreadRowCoreProjection } from "../../../threads/list/row-projection";

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

export interface ToolbarThreadRow extends ThreadRowCoreProjection {
  readonly renameDisabled: boolean;
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
