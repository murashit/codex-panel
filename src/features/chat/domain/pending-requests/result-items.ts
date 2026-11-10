import { definedProp } from "../../../../domain/objects/optional-properties";
import type { ThreadStreamItem, ThreadStreamUserInputQuestionResult } from "../thread-stream/items";
import {
  type ApprovalAction,
  type ApprovalActionIntent,
  approvalActionKind,
  type McpElicitationAction,
  type McpElicitationContentValue,
  type PendingApproval,
  type PendingMcpElicitation,
  type PendingUserInput,
} from "./model";

const approvalResultLabels = {
  accept: { prefix: "Allowed", status: "allowed" },
  "accept-session": { prefix: "Allowed for this session", status: "allowed for session" },
  "accept-rule": { prefix: "Allowed with rule", status: "allowed with rule" },
  "decline-rule": { prefix: "Denied with rule", status: "denied with rule" },
  cancel: { prefix: "Cancelled", status: "cancelled" },
  decline: { prefix: "Denied", status: "denied" },
} satisfies Record<ApprovalActionIntent, { prefix: string; status: string }>;

export function createApprovalResultItem(approval: PendingApproval, action: ApprovalAction, id: string): ThreadStreamItem {
  const kind = approvalActionKind(action);
  const { prefix, status } = approvalResultLabels[kind];
  const rule = kind === "accept-rule" || kind === "decline-rule";
  return {
    id,
    kind: "approvalResult",
    role: "tool",
    text: `${prefix}: ${approval.resultSummary}`,
    ...definedProp("turnId", approval.turnId),
    provenance: { source: "localUser", channel: "response", interaction: "approvalResponse", sourceId: String(approval.requestId) },
    executionState: kind === "accept" || kind === "accept-session" || kind === "accept-rule" ? "completed" : "failed",
    approval: {
      status,
      scope: rule ? "rule" : approval.kind === "humanCommand" ? "command" : kind === "accept-session" ? "session" : "turn",
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
    ...(status === "submitted" && !question.isSecret ? { answer: answers[question.id] ?? "" } : {}),
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
  if (typeof value === "undefined") return "";
  return String(value);
}
