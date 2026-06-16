export type PendingRequestId = string | number;

type SimpleApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";

export type CommandApprovalDecision =
  | SimpleApprovalDecision
  | { acceptWithExecpolicyAmendment: unknown }
  | { applyNetworkPolicyAmendment: { network_policy_amendment: { action: "allow" | "deny"; [key: string]: unknown } } };

export interface CommandApprovalParams {
  threadId: string;
  turnId: string;
  itemId: string;
  startedAtMs: number;
  approvalId?: string | null;
  reason?: string | null;
  networkApprovalContext?: unknown;
  command?: string | null;
  cwd?: string | null;
  commandActions?: unknown[] | null;
  additionalPermissions?: unknown;
  proposedExecpolicyAmendment?: unknown;
  proposedNetworkPolicyAmendments?: unknown[] | null;
  availableDecisions?: CommandApprovalDecision[] | null;
}

export interface FileChangeApprovalParams {
  threadId: string;
  turnId: string;
  itemId: string;
  startedAtMs: number;
  reason: string | null;
  grantRoot: string | null;
}

export interface PermissionProfile {
  network?: { enabled?: boolean | null } | null;
  fileSystem?: {
    entries?: readonly { path: unknown; access?: unknown }[] | null;
    read?: unknown;
    write?: unknown;
    globScanMaxDepth?: unknown;
  } | null;
}

export interface PermissionsApprovalParams {
  threadId: string;
  turnId: string;
  itemId: string;
  startedAtMs: number;
  reason: string | null;
  cwd: string;
  environmentId: string | null;
  permissions: PermissionProfile;
}

export type ApprovalAction = "accept" | "accept-session" | "decline" | "cancel" | CommandApprovalDecisionAction;

export interface CommandApprovalDecisionAction {
  kind: "command-decision";
  decision: CommandApprovalDecision;
}

export type PendingApproval =
  | {
      requestId: PendingRequestId;
      method: "item/commandExecution/requestApproval";
      params: CommandApprovalParams;
    }
  | {
      requestId: PendingRequestId;
      method: "item/fileChange/requestApproval";
      params: FileChangeApprovalParams;
    }
  | {
      requestId: PendingRequestId;
      method: "item/permissions/requestApproval";
      params: PermissionsApprovalParams;
    };

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
  options: PendingUserInputOption[] | null;
}

export interface PendingUserInputParams {
  threadId: string;
  turnId: string;
  itemId: string;
  questions: PendingUserInputQuestion[];
  autoResolutionMs: number | null;
}

export interface PendingUserInput {
  requestId: PendingRequestId;
  method: "item/tool/requestUserInput";
  params: PendingUserInputParams;
}

export function approvalActionKind(action: ApprovalAction): "accept" | "accept-session" | "decline" | "cancel" {
  if (!isCommandDecisionAction(action)) return action;
  const decision = action.decision;
  if (decision === "accept") return "accept";
  if (decision === "acceptForSession") return "accept-session";
  if (decision === "cancel") return "cancel";
  if (decision === "decline") return "decline";
  if ("acceptWithExecpolicyAmendment" in decision) return "accept-session";
  if ("applyNetworkPolicyAmendment" in decision) {
    return decision.applyNetworkPolicyAmendment.network_policy_amendment.action === "allow" ? "accept-session" : "decline";
  }
  return "decline";
}

export function isCommandDecisionAction(action: ApprovalAction): action is CommandApprovalDecisionAction {
  return typeof action === "object";
}

export function questionDefaultAnswer(question: PendingUserInputQuestion): string {
  return question.options?.[0]?.label ?? "";
}

export function userInputDraftKey(requestId: PendingRequestId, questionId: string): string {
  return `${String(requestId)}:${questionId}`;
}

export function userInputOtherDraftKey(requestId: PendingRequestId, questionId: string): string {
  return `${String(requestId)}:${questionId}:other`;
}

export function answersForPendingUserInput(input: PendingUserInput, drafts: ReadonlyMap<string, string>): Record<string, string> {
  return Object.fromEntries(
    input.params.questions.map((question) => [
      question.id,
      drafts.get(userInputDraftKey(input.requestId, question.id)) ?? questionDefaultAnswer(question),
    ]),
  );
}
