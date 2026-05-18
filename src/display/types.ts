export type DisplayKind =
  | "message"
  | "command"
  | "fileChange"
  | "tool"
  | "taskProgress"
  | "agent"
  | "hook"
  | "reasoning"
  | "system"
  | "approvalResult"
  | "userInputResult"
  | "reviewResult";
export type DisplayRole = "user" | "assistant" | "system" | "tool";
export type ExecutionState = "running" | "completed" | "failed" | null;

export interface DisplayBase {
  id: string;
  kind: DisplayKind;
  role: DisplayRole;
  text: string;
  turnId?: string;
  itemId?: string;
  state?: ExecutionState;
}

export interface DisplayDetailMetaRow {
  key: string;
  value: string;
}

export interface DisplayDetailSection {
  title?: string;
  body?: string;
  rows?: DisplayDetailMetaRow[];
}

export interface MessageDisplayItem extends DisplayBase {
  kind: "message";
  role: "user" | "assistant";
  copyText?: string;
  referencedThread?: ReferencedThreadDisplay;
  proposedPlan?: boolean;
  editedFiles?: string[];
  turnDiff?: DisplayTurnDiff;
  autoReviewSummaries?: string[];
  markdown?: boolean;
}

export interface ReferencedThreadDisplay {
  threadId: string;
  title: string;
  includedTurns: number;
  turnLimit: number;
}

export interface DisplayTurnDiff {
  diff: string;
}

export interface SystemDisplayItem extends DisplayBase {
  kind: "system" | "userInputResult";
  role: "system" | "tool";
  markdown?: boolean;
  details?: DisplayDetailSection[];
}

export interface ApprovalResultDisplayItem extends DisplayBase {
  kind: "approvalResult";
  role: "tool";
  markdown?: boolean;
  details?: DisplayDetailSection[];
}

export interface ReviewResultDisplayItem extends DisplayBase {
  kind: "reviewResult";
  role: "tool";
  markdown?: boolean;
  details?: DisplayDetailSection[];
}

export interface CommandDisplayItem extends DisplayBase {
  kind: "command";
  role: "tool";
  actionLabel?: string;
  command: string;
  cwd: string;
  status: string;
  exitCode?: number;
  durationMs?: number;
  output?: string;
}

export interface DisplayFileChange {
  kind: string;
  path: string;
  diff: string;
}

export interface FileChangeDisplayItem extends DisplayBase {
  kind: "fileChange";
  role: "tool";
  status: string;
  changes: DisplayFileChange[];
  output?: string;
}

export interface ToolDisplayItem extends DisplayBase {
  kind: "tool" | "hook" | "reasoning";
  role: "tool";
  toolLabel?: string;
  summaryPath?: boolean;
  status?: string;
  output?: string;
  details?: DisplayDetailSection[];
}

export interface TaskProgressStep {
  step: string;
  status: "pending" | "inProgress" | "completed";
}

export interface TaskProgressDisplayItem extends DisplayBase {
  kind: "taskProgress";
  role: "tool";
  explanation: string | null;
  steps: TaskProgressStep[];
  status: string;
}

export interface AgentStateDisplay {
  threadId: string;
  status: string;
  message: string | null;
}

export interface AgentRunSummaryAgent {
  threadId: string;
  status: string;
  messagePreview: string | null;
}

export interface AgentDisplayItem extends DisplayBase {
  kind: "agent";
  role: "tool";
  tool: string;
  status: string;
  senderThreadId: string;
  receiverThreadIds: string[];
  prompt: string | null;
  model: string | null;
  reasoningEffort: string | null;
  agents: AgentStateDisplay[];
}

export interface AgentRunSummary {
  running: number;
  completed: number;
  failed: number;
  agents: AgentRunSummaryAgent[];
  additionalAgents: number;
}

export type DisplayItem =
  | MessageDisplayItem
  | SystemDisplayItem
  | CommandDisplayItem
  | FileChangeDisplayItem
  | ToolDisplayItem
  | TaskProgressDisplayItem
  | AgentDisplayItem
  | ApprovalResultDisplayItem
  | ReviewResultDisplayItem;

export type DisplayBlock =
  | {
      type: "item";
      item: DisplayItem;
    }
  | {
      type: "activityGroup";
      id: string;
      turnId: string;
      summary: string;
      items: DisplayItem[];
    };
