import {
  type ApprovalAction,
  approvalActionKind,
  type McpElicitationAction,
  type McpElicitationContentValue,
  type PendingApproval,
  type PendingMcpElicitation,
  type PendingUserInput,
} from "../../../../domain/interaction-requests/model";
import type { ThreadStreamItem, ThreadStreamUserInputQuestionResult } from "../thread-stream/items";

export function createApprovalResultItem(approval: PendingApproval, action: ApprovalAction): ThreadStreamItem {
  const kind = approvalActionKind(action);
  return {
    id: `approval-${String(approval.requestId)}`,
    kind: "approvalResult",
    role: "tool",
    text: approvalResultText(approval, action),
    ...definedProp("turnId", approval.turnId ?? undefined),
    provenance: { source: "localUser", channel: "response", interaction: "approvalResponse", sourceId: String(approval.requestId) },
    executionState: kind === "accept" || kind === "accept-session" ? "completed" : "failed",
    approval: {
      status: approvalResultStatus(kind),
      scope: kind === "accept-session" ? "session" : "turn",
      request: approval.title,
      auditFacts: [...approval.details],
    },
  };
}

export function createUserInputResultItem(
  input: PendingUserInput,
  answers: Record<string, string>,
  status: "submitted" | "cancelled",
): ThreadStreamItem {
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

export function createMcpElicitationResultItem(
  elicitation: PendingMcpElicitation,
  action: McpElicitationAction,
  content: Record<string, McpElicitationContentValue> | null,
): ThreadStreamItem {
  const accepted = action === "accept";
  return {
    id: `mcp-elicitation-${action}-${String(elicitation.requestId)}`,
    kind: "userInputResult",
    role: "tool",
    text: mcpElicitationResultText(elicitation, action),
    ...definedProp("turnId", elicitation.params.turnId ?? undefined),
    provenance: { source: "localUser", channel: "response", interaction: "userInputResponse", sourceId: String(elicitation.requestId) },
    executionState: accepted ? "completed" : "failed",
    questions: mcpElicitationResultQuestions(elicitation, accepted, accepted ? content : null),
  };
}

function approvalResultText(approval: PendingApproval, action: ApprovalAction): string {
  return `${approvalResultPrefix(approvalActionKind(action))}: ${approval.resultSummary}`;
}

function approvalResultPrefix(kind: ReturnType<typeof approvalActionKind>): string {
  if (kind === "accept") return "Allowed";
  if (kind === "accept-session") return "Allowed for this session";
  if (kind === "cancel") return "Cancelled";
  return "Denied";
}

function approvalResultStatus(kind: ReturnType<typeof approvalActionKind>): string {
  if (kind === "accept") return "allowed";
  if (kind === "accept-session") return "allowed for session";
  if (kind === "cancel") return "cancelled";
  return "denied";
}

function mcpElicitationResultText(elicitation: PendingMcpElicitation, action: McpElicitationAction): string {
  const label = `MCP request from ${elicitation.params.serverName}`;
  if (action === "accept") return `${label} accepted.`;
  if (action === "decline") return `${label} declined.`;
  return `${label} cancelled.`;
}

function mcpElicitationResultQuestions(
  elicitation: PendingMcpElicitation,
  accepted: boolean,
  content: Record<string, McpElicitationContentValue> | null,
): readonly ThreadStreamUserInputQuestionResult[] {
  if (elicitation.params.mode === "url") {
    return [
      {
        id: "url",
        header: "URL",
        question: elicitation.params.message,
        ...(accepted ? { answer: elicitation.params.url } : {}),
      },
    ];
  }
  return elicitation.params.fields.map((field) => ({
    id: field.id,
    header: field.title || field.id,
    question: field.description ?? field.title,
    ...(content ? { answer: formatMcpElicitationContentValue(content[field.id]) } : {}),
  }));
}

function formatMcpElicitationContentValue(value: McpElicitationContentValue | undefined): string {
  if (Array.isArray(value)) return value.join(", ");
  if (value === null || typeof value === "undefined") return "";
  return String(value);
}

function definedProp<Key extends string, Value>(key: Key, value: Value | null | undefined): Record<Key, Value> | Record<string, never> {
  return value === null || value === undefined ? {} : ({ [key]: value } as Record<Key, Value>);
}
