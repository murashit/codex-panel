import type { ApprovalAction, PendingMcpElicitationField, PendingRequestId } from "../../../../domain/interaction-requests/model";
import type { ExecutionState, TaskProgressThreadStreamItem } from "../../domain/thread-stream/items";
import type { PlanImplementationTarget } from "../../domain/thread-stream/selectors";

export function threadStreamExecutionClassName(state: ExecutionState | null): string {
  if (state === "completed") return "codex-panel__execution codex-panel__execution--completed";
  if (state === "failed") return "codex-panel__execution codex-panel__execution--failed";
  if (state === "running") return "codex-panel__execution codex-panel__execution--running";
  return "";
}

export interface PendingApprovalViewModel {
  requestId: PendingRequestId;
  title: string;
  summary: string;
  details: { key: string; value: string }[];
  actions: {
    id: string;
    label: string;
    action: ApprovalAction;
    className: string;
  }[];
}

export interface PendingUserInputQuestionViewModel {
  id: string;
  header?: string | null;
  question: string;
  isOther: boolean;
  isSecret: boolean;
  defaultAnswer: string;
  draftKey: string;
  otherDraftKey: string;
  options: readonly { label: string; description?: string | null }[] | null;
}

export interface PendingUserInputViewModel {
  requestId: PendingRequestId;
  title: string;
  body: string;
  questions: readonly PendingUserInputQuestionViewModel[];
}

export interface PendingMcpElicitationFieldViewModel {
  id: string;
  title: string;
  description: string | null;
  type: PendingMcpElicitationField["type"];
  required: boolean;
  defaultDraft: string;
  draftKey: string;
  options: readonly { value: string; label: string }[] | null;
}

export interface PendingMcpElicitationViewModel {
  requestId: PendingRequestId;
  title: string;
  body: string;
  mode: "form" | "url";
  serverName: string;
  message: string;
  fields: readonly PendingMcpElicitationFieldViewModel[];
  url: string | null;
}

export interface PendingRequestBlockSnapshot {
  approvals: readonly PendingApprovalViewModel[];
  pendingUserInputs: readonly PendingUserInputViewModel[];
  pendingMcpElicitations: readonly PendingMcpElicitationViewModel[];
  userInputDrafts: ReadonlyMap<string, string>;
  mcpElicitationDrafts: ReadonlyMap<string, string>;
  approvalDetails: ReadonlySet<string>;
}

export type DetailSection =
  | { kind: "kv"; title?: string; rows: readonly { readonly key: string; readonly value: string }[] }
  | { kind: "output"; title: string; body: string }
  | { kind: "diff"; title: string; diff: string };

export interface DetailView {
  className: string;
  label: string;
  summary: string;
  summaryThreadIds: readonly string[];
  detailsKey: string;
  sections: DetailSection[];
  state: ExecutionState;
}

export type ThreadStreamStatusView =
  | {
      kind: "taskProgress";
      label: "tasks";
      className: string;
      state: ExecutionState;
      summary: string | null;
      checklist: readonly TaskProgressThreadStreamItem["steps"][number][];
    }
  | {
      kind: "contextCompaction";
      label: "context";
      className: string;
      state: ExecutionState;
      text: string;
    }
  | {
      kind: "reasoning";
      active: boolean;
      label: string;
      text: string;
    }
  | {
      kind: "generic";
      label: string;
      className: string;
      state: ExecutionState;
      text: string;
    };

export interface AgentRunSummaryView {
  label: "agents";
  className: string;
  state: ExecutionState;
  summary: string;
  rows: readonly { threadId: string; threadLabel: string; status: string }[];
  additionalAgents: number;
}

export interface ThreadStreamForkTarget {
  itemId: string;
  turnId: string;
}

export interface ThreadStreamTextActionTargets {
  fork?: ThreadStreamForkTarget;
  rollback?: true;
  implementPlan?: PlanImplementationTarget;
}

export interface ReferencedThreadTextView {
  title: string;
  includedTurns: number;
  turnLimit: number;
  truncated?: boolean;
}

export interface ContextItemTextView {
  label: string;
  detail?: string;
}

export interface EditedFilesTextView {
  files: readonly string[];
  turnDiff?: {
    turnId: string;
    diff: string;
  };
}

export interface TextItemDetailSectionView {
  title?: string;
  facts?: readonly { readonly key: string; readonly value: string }[];
  body?: string;
}

export interface ThreadStreamTextView {
  id: string;
  roleLabel: string;
  body: string;
  className: string;
  contentKey: string;
  renderMode: "text" | "streamMarkdown" | "obsidianMarkdown";
  collapsible: boolean;
  copyText?: string;
  actionTargets: ThreadStreamTextActionTargets;
  metadata: {
    editedFiles?: EditedFilesTextView;
    referencedThread?: ReferencedThreadTextView;
    contextItems?: {
      itemId: string;
      items: readonly ContextItemTextView[];
    };
    autoReviewSummaries: readonly string[];
    systemDetails: readonly TextItemDetailSectionView[];
    userInputDetails: readonly TextItemDetailSectionView[];
  };
}

export type ThreadStreamRenderedItemView =
  | {
      kind: "text";
      view: ThreadStreamTextView;
    }
  | {
      kind: "detail";
      view: DetailView;
    }
  | {
      kind: "status";
      view: ThreadStreamStatusView;
    };

export type ThreadStreamActivityItemView =
  | ({
      type: "item";
      id: string;
    } & ThreadStreamRenderedItemView)
  | {
      type: "steering";
      id: string;
      label: string;
      text: string;
      sourceItemId: string;
    };

export type ThreadStreamViewBlock =
  | {
      kind: "historyBar";
      key: "history-bar";
      loadingHistory: boolean;
    }
  | {
      kind: "empty";
      key: "empty";
    }
  | ({
      key: string;
    } & ThreadStreamRenderedItemView)
  | {
      kind: "activityGroup";
      key: string;
      id: string;
      turnId: string;
      summary: string;
      items: ThreadStreamActivityItemView[];
    }
  | {
      kind: "liveAgentSummary";
      key: string;
      view: AgentRunSummaryView;
    }
  | {
      kind: "pendingRequests";
      key: "pending-requests";
      signature: string;
      snapshot: PendingRequestBlockSnapshot;
    };
