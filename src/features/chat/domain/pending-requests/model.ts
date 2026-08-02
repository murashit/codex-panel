export type PendingRequestId = string | number;

export type ApprovalActionIntent = "accept" | "accept-session" | "decline" | "cancel";

type ApprovalKind = "command" | "fileChange" | "permission";

export interface ApprovalDetailRow {
  key: string;
  value: string;
}

interface ApprovalOptionAction {
  kind: "approval-option";
  optionId: string;
  intent: ApprovalActionIntent;
}

export type ApprovalAction = ApprovalActionIntent | ApprovalOptionAction;

export interface PendingApprovalOption {
  id: string;
  label: string;
  action: ApprovalAction;
}

export interface PendingApproval {
  requestId: PendingRequestId;
  kind: ApprovalKind;
  turnId: string | null;
  title: string;
  summary: string;
  resultSummary: string;
  details: readonly ApprovalDetailRow[];
  actionOptions: readonly PendingApprovalOption[] | null;
}

interface PendingUserInputOption {
  label: string;
  description: string;
}

export interface PendingUserInputQuestion {
  id: string;
  header: string;
  question: string;
  isOther: boolean;
  isSecret: boolean;
  options: readonly PendingUserInputOption[] | null;
}

interface PendingUserInputParams {
  turnId: string;
  questions: readonly PendingUserInputQuestion[];
}

export interface PendingUserInput {
  requestId: PendingRequestId;
  params: PendingUserInputParams;
}

export type McpElicitationAction = "accept" | "decline" | "cancel";

export type McpElicitationContentValue = string | number | boolean | readonly string[] | null;

export interface PendingMcpElicitationOption {
  value: string;
  label: string;
}

interface PendingMcpElicitationFieldBase {
  id: string;
  title: string;
  description: string | null;
  required: boolean;
}

export type PendingMcpElicitationField =
  | (PendingMcpElicitationFieldBase & {
      type: "string";
      defaultValue: string;
    })
  | (PendingMcpElicitationFieldBase & {
      type: "number" | "integer";
      defaultValue: number | null;
    })
  | (PendingMcpElicitationFieldBase & {
      type: "boolean";
      defaultValue: boolean;
    })
  | (PendingMcpElicitationFieldBase & {
      type: "single-select";
      options: readonly PendingMcpElicitationOption[];
      defaultValue: string;
    })
  | (PendingMcpElicitationFieldBase & {
      type: "multi-select";
      options: readonly PendingMcpElicitationOption[];
      defaultValue: readonly string[];
    });

interface PendingMcpElicitationFormParams {
  turnId: string | null;
  serverName: string;
  mode: "form";
  message: string;
  fields: readonly PendingMcpElicitationField[];
}

interface PendingMcpElicitationUrlParams {
  turnId: string | null;
  serverName: string;
  mode: "url";
  message: string;
  url: string;
}

export interface PendingMcpElicitation {
  requestId: PendingRequestId;
  params: PendingMcpElicitationFormParams | PendingMcpElicitationUrlParams;
}

export function approvalActionKind(action: ApprovalAction): "accept" | "accept-session" | "decline" | "cancel" {
  return typeof action === "object" ? action.intent : action;
}
