import { approvalActionKind, type ApprovalAction, type PendingApproval } from "../../protocol/server-requests/approval";
import { approvalDetails, approvalResultSummary, approvalTitle } from "./approval-view";
import type { MessageStreamItem } from "../../message-stream/items";
import type { PendingUserInput } from "../../protocol/server-requests/user-input";
import { definedProp } from "../../../../utils";

export function createApprovalResultItem(approval: PendingApproval, action: ApprovalAction): MessageStreamItem {
  const status = approvalResultStatus(action);
  const kind = approvalActionKind(action);
  const scope = kind === "accept-session" ? "session" : "turn";
  return {
    id: `approval-${String(approval.requestId)}`,
    kind: "approvalResult",
    role: "tool",
    text: approvalResultText(approval, action),
    ...definedProp("turnId", approvalTurnId(approval)),
    provenance: { source: "localUser", channel: "response", interaction: "approvalResponse", sourceId: String(approval.requestId) },
    executionState: kind === "accept" || kind === "accept-session" ? "completed" : "failed",
    approval: {
      status,
      scope,
      request: approvalTitle(approval),
      auditFacts: approvalDetails(approval),
    },
  };
}

export function createUserInputResultItem(
  input: PendingUserInput,
  answers: Record<string, string>,
  status: "submitted" | "cancelled",
): MessageStreamItem {
  const questionCount = input.params.questions.length;
  const label = questionCount === 1 ? "1 question" : `${String(questionCount)} questions`;
  const questions = input.params.questions.map((question) => ({
    id: question.id,
    header: question.header || question.id,
    question: question.question,
    ...(status === "submitted" ? { answer: answers[question.id] ?? "" } : {}),
  }));
  return {
    id: `user-input-${status}-${String(input.requestId)}`,
    kind: "userInputResult",
    role: "tool",
    text: status === "submitted" ? `Input submitted for ${label}.` : `Input request cancelled for ${label}.`,
    ...definedProp("turnId", input.params.turnId),
    provenance: { source: "localUser", channel: "response", interaction: "userInputResponse", sourceId: String(input.requestId) },
    executionState: status === "submitted" ? "completed" : "failed",
    questions,
  };
}

function approvalResultText(approval: PendingApproval, action: ApprovalAction): string {
  return `${approvalResultPrefix(action)}: ${approvalResultSummary(approval)}`;
}

function approvalResultPrefix(action: ApprovalAction): string {
  const kind = approvalActionKind(action);
  if (kind === "accept") return "Allowed";
  if (kind === "accept-session") return "Allowed for this session";
  if (kind === "cancel") return "Cancelled";
  return "Denied";
}

function approvalResultStatus(action: ApprovalAction): string {
  const kind = approvalActionKind(action);
  if (kind === "accept") return "allowed";
  if (kind === "accept-session") return "allowed for session";
  if (kind === "cancel") return "cancelled";
  return "denied";
}

function approvalTurnId(approval: PendingApproval): string | undefined {
  const params = approval.params as { turnId?: unknown };
  return typeof params.turnId === "string" ? params.turnId : undefined;
}
